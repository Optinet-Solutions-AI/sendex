"use client";

import {
  addUploadSummary,
  applyMapping,
  COLUMN_TYPE_LABELS,
  COLUMN_TYPES,
  type ColumnMapping,
  ColumnMappingSchema,
  type ColumnType,
  countriesList,
  countryByCode,
  countSpreadsheetDamaged,
  DROP_REASON_LABELS,
  type DropReason,
  type DuplicateMode,
  defaultListName,
  detectColumns,
  detectListCountry,
  emptyUploadSummary,
  importedGood,
  type ListCountry,
  totalDropped,
  UPLOAD_CHUNK_SIZE,
  type UploadRow,
  type UploadSettingsInput,
  UploadSettingsSchema,
  type UploadSummary,
} from "@sendex/core";
import type { ListNameRow } from "@sendex/db";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Input,
  Label,
  PageHeader,
  SegmentedControl,
  SimpleSelect,
  Textarea,
} from "@sendex/ui";
import { Check, FileText, Sparkles, Upload, X } from "lucide-react";
import Link from "next/link";
import Papa from "papaparse";
import { type ChangeEvent, type DragEvent, useId, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { formatNumber } from "../../../../lib/format";
import { finishUpload, importChunk, startUpload } from "../actions";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PREVIEW_ROWS = 10;
const DETECT_SAMPLE = 50;
const ACCEPTED_EXTENSIONS = ["csv", "txt", "xls", "xlsx"];

/** Reasons a row is rejected, in the order the summary lists them. VoIP is never produced today. */
const SHOWN_DROP_REASONS: readonly DropReason[] = [
  "invalid",
  "damaged",
  "unparseable",
  "no_country",
  "premium",
  "toll_free",
  "landline",
];

const columnTypeOptions = COLUMN_TYPES.map((t) => ({ value: t, label: COLUMN_TYPE_LABELS[t] }));
const NEW_LIST = "__new__";
const AUTO_COUNTRY = "auto";
const PASTED_NAME = "pasted text";
type CountryChoice = ListCountry | typeof AUTO_COUNTRY;

const countryOptions = [
  { value: AUTO_COUNTRY, label: "Auto-detect from file" },
  ...countriesList.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` })),
];
const duplicateOptions: ReadonlyArray<{ value: DuplicateMode; label: string }> = [
  { value: "allow", label: "Allow duplicates" },
  { value: "skip_existing", label: "Skip numbers already in my contacts" },
];

/** Spreadsheet column letters: 0 -> A, 25 -> Z, 26 -> AA. */
function columnLetter(index: number): string {
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

type Mode = "files" | "paste";

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; done: number; total: number; file: string }
  | { kind: "done"; listId: string; listName: string; summary: UploadSummary; files: number };

interface ParsedFile {
  /** Stable key for the file queue. */
  id: string;
  name: string;
  source: "file" | "paste";
  rows: string[][];
  /** File size (or pasted text length) in bytes, for File Details. */
  bytes: number;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function nonEmpty(rows: string[][]): string[][] {
  return rows.filter((row) => row.some((cell) => String(cell ?? "").trim().length > 0));
}

function parseText(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return nonEmpty(parsed.data);
}

/** First sheet of an XLS or XLSX workbook as rows of strings. */
function parseWorkbook(buffer: ArrayBuffer): string[][] {
  const workbook = XLSX.read(buffer, { type: "array" });
  const name = workbook.SheetNames[0];
  const sheet = name ? workbook.Sheets[name] : undefined;
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
  return nonEmpty(rows.map((row) => row.map((cell) => String(cell ?? ""))));
}

/**
 * Upload Contacts after SMS Edge. Step one is the centred card with Upload Files (CSV, TXT, XLS,
 * XLSX, several at once) or Paste CSV. Step two is "Import <file>": Settings and File Details
 * on the left, the Field Types grid on the right, Cancel and Import under it. Every file becomes
 * its own import job on the Files page; the summary at the end sums them up.
 */
export function UploadForm({
  lists,
  fixedList,
}: {
  lists: ListNameRow[];
  /** Data Files tab: upload straight into this list (no target choice, no page header). */
  fixedList?: { id: string; name: string; country: string };
}) {
  const ids = {
    file: useId(),
    paste: useId(),
    list: useId(),
    name: useId(),
    country: useId(),
    header: useId(),
    logical: useId(),
    duplicates: useId(),
    flush: useId(),
  };
  const fileInput = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<Mode>("files");
  const [files, setFiles] = useState<ParsedFile[]>([]);
  const [pasted, setPasted] = useState("");
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<ColumnType[]>([]);
  const [detected, setDetected] = useState<ColumnType[]>([]);
  const [mappingTouched, setMappingTouched] = useState(false);
  const [columnNames, setColumnNames] = useState<string[]>([]);

  const [listValue, setListValue] = useState<string>(fixedList?.id ?? NEW_LIST);
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [countryChoice, setCountryChoice] = useState<CountryChoice>(AUTO_COUNTRY);
  const [logicalCheck, setLogicalCheck] = useState(true);
  const [duplicates, setDuplicates] = useState<DuplicateMode>("allow");
  const [flushAfterImport, setFlushAfterImport] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const isNew = !fixedList && listValue === NEW_LIST;
  const existingList = fixedList ?? lists.find((l) => l.id === listValue);
  const fixedCountry: ListCountry | undefined = isNew
    ? countryChoice === AUTO_COUNTRY
      ? undefined
      : countryChoice
    : (existingList?.country as ListCountry | undefined);
  const first = files[0];

  function applyDetection(rows: string[][], forCountry: ListCountry | undefined) {
    const [head, ...rest] = rows;
    if (!head) return;
    const found = detectColumns(head, rest.slice(0, DETECT_SAMPLE), forCountry);
    const types = found.columns.map((c) => c.type);
    setHasHeader(found.hasHeader);
    setMapping(types);
    setDetected(types);
    setColumnNames(found.columns.map((c) => c.name));
    setMappingTouched(false);
  }

  function addFiles(parsed: ParsedFile[]) {
    const usable = parsed.filter((f) => f.rows.length > 0);
    if (usable.length === 0) {
      setError("No rows found.");
      return;
    }
    setError(null);
    setPhase({ kind: "idle" });
    const isFirst = files.length === 0;
    setFiles((current) => [...current, ...usable]);
    const lead = usable[0];
    if (isFirst && lead) {
      applyDetection(lead.rows, fixedCountry);
      if (!nameTouched) setName(defaultListName(lead.name));
    }
  }

  async function loadFile(file: File): Promise<ParsedFile | null> {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setError(`Only CSV, TXT, XLS and XLSX files are accepted (got "${file.name}").`);
      return null;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB.`);
      return null;
    }
    const rows =
      extension === "xls" || extension === "xlsx"
        ? parseWorkbook(await file.arrayBuffer())
        : parseText(await file.text());
    return { id: crypto.randomUUID(), name: file.name, source: "file", rows, bytes: file.size };
  }

  async function loadFiles(list: FileList | File[]) {
    const parsed: ParsedFile[] = [];
    for (const file of Array.from(list)) {
      const one = await loadFile(file);
      if (one) parsed.push(one);
    }
    if (parsed.length > 0) addFiles(parsed);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void loadFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    void loadFiles(event.dataTransfer.files);
  }

  function applyPasted() {
    addFiles([
      {
        id: crypto.randomUUID(),
        name: PASTED_NAME,
        source: "paste",
        rows: parseText(pasted),
        bytes: new Blob([pasted]).size,
      },
    ]);
  }

  function cancel() {
    setFiles([]);
    setMapping([]);
    setDetected([]);
    setColumnNames([]);
    setError(null);
    setPhase({ kind: "idle" });
    if (!nameTouched) setName("");
  }

  function removeFile(index: number) {
    const next = files.filter((_, i) => i !== index);
    setFiles(next);
    if (next.length === 0) cancel();
    else if (index === 0 && next[0]) applyDetection(next[0].rows, fixedCountry);
  }

  function changeCountry(value: string) {
    const next = value === AUTO_COUNTRY ? AUTO_COUNTRY : (value as ListCountry);
    setCountryChoice(next);
    if (first && !mappingTouched) {
      applyDetection(first.rows, next === AUTO_COUNTRY ? undefined : next);
    }
  }

  function setColumnType(index: number, type: ColumnType) {
    setMappingTouched(true);
    setMapping((current) => current.map((t, i) => (i === index ? type : t)));
  }

  const dataRowsOf = (file: ParsedFile) => (hasHeader ? file.rows.slice(1) : file.rows);
  const totalRows = files.reduce((sum, f) => sum + dataRowsOf(f).length, 0);
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const previewRows = first ? dataRowsOf(first).slice(0, PREVIEW_ROWS) : [];
  const phoneSet = mapping.includes("phone");
  // Numbers a spreadsheet program cut short (4.91516E+12): counted here so the user hears about
  // it before importing, not from the rejects afterwards.
  const phoneIndex = mapping.indexOf("phone");
  const damagedNumbers =
    phoneIndex < 0
      ? 0
      : files.reduce(
          (sum, f) =>
            sum +
            countSpreadsheetDamaged(dataRowsOf(f).map((row) => String(row[phoneIndex] ?? ""))),
          0,
        );

  // "Auto-detect from file" needs a country column with something readable in it.
  const autoCountry = isNew && countryChoice === AUTO_COUNTRY;
  const detectedCountry = autoCountry
    ? detectListCountry(files.flatMap(dataRowsOf), mapping)
    : undefined;
  const countryError =
    autoCountry && files.length > 0
      ? !mapping.includes("country")
        ? 'Pick a country — "Auto-detect from file" only works when the file has a country column.'
        : detectedCountry === undefined
          ? "No country in the file's country column could be read — pick one."
          : null
      : null;
  const listCountry: ListCountry | undefined = fixedCountry ?? detectedCountry;

  async function submit() {
    if (files.length === 0) return;
    setError(null);
    const mappingResult = ColumnMappingSchema.safeParse(mapping);
    if (!mappingResult.success) {
      setError(mappingResult.error.issues[0]?.message ?? "Fix the field types.");
      return;
    }
    if (isNew && !listCountry) {
      setError(countryError ?? "Pick a country.");
      return;
    }
    const settingsInput: UploadSettingsInput = {
      target:
        isNew && listCountry
          ? { kind: "new", name: name.trim(), country: listCountry }
          : { kind: "existing", listId: existingList?.id ?? "" },
      logicalCheck,
      duplicates,
      flushAfterImport,
    };
    const settingsResult = UploadSettingsSchema.safeParse(settingsInput);
    if (!settingsResult.success) {
      const issue = settingsResult.error.issues[0];
      setError(
        issue?.path.includes("name")
          ? "Give the new list a name (1 to 100 characters)."
          : (issue?.message ?? "Check the settings."),
      );
      return;
    }

    setPhase({ kind: "uploading", done: 0, total: totalRows, file: first?.name ?? "" });
    const started = await startUpload(settingsInput);
    if (!started.ok) {
      setError(started.error);
      setPhase({ kind: "idle" });
      return;
    }

    let overall = emptyUploadSummary();
    let done = 0;
    for (const [index, file] of files.entries()) {
      const dataRows = dataRowsOf(file);
      let summary = emptyUploadSummary();
      for (const batch of chunk(dataRows, UPLOAD_CHUNK_SIZE)) {
        const rows: UploadRow[] = [];
        let blank = 0;
        for (const cells of batch) {
          const row = applyMapping(cells, mappingResult.data as ColumnMapping);
          if (row.phone.length === 0) blank += 1;
          else rows.push(row);
        }
        const result = await importChunk({
          listId: started.data.listId,
          rows,
          logicalCheck,
          duplicates,
        });
        if (!result.ok) {
          setError(
            `${result.error} (${formatNumber(done)} of ${formatNumber(totalRows)} rows processed)`,
          );
          setPhase({ kind: "idle" });
          return;
        }
        summary = addUploadSummary(summary, result.data);
        summary.rows += blank;
        summary.dropped.unparseable += blank;
        done += batch.length;
        setPhase({ kind: "uploading", done, total: totalRows, file: file.name });
      }
      const finished = await finishUpload({
        listId: started.data.listId,
        fileName: file.name,
        source: file.source,
        logicalCheck,
        duplicates,
        // Flush once, after the last file.
        flushAfterImport: flushAfterImport && index === files.length - 1,
        summary,
      });
      if (!finished.ok) {
        setError(finished.error);
        setPhase({ kind: "idle" });
        return;
      }
      overall = addUploadSummary(overall, summary);
    }
    setPhase({
      kind: "done",
      listId: started.data.listId,
      listName: started.data.name,
      summary: overall,
      files: files.length,
    });
  }

  if (phase.kind === "done") {
    return (
      <Summary
        listId={phase.listId}
        listName={phase.listName}
        summary={phase.summary}
        files={phase.files}
      />
    );
  }

  const uploading = phase.kind === "uploading";
  const errorBox = error ? (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
      {error}
    </p>
  ) : null;

  // Step one: the centred Upload Files / Paste CSV card.
  if (!first) {
    return (
      <div>
        {fixedList ? null : (
          <PageHeader
            breadcrumb={[{ label: "Contacts", href: "/lists" }, { label: "Upload Contacts" }]}
            title="Upload Contacts"
          />
        )}
        <div className="mx-auto max-w-2xl space-y-4">
          <SegmentedControl
            label="Upload mode"
            value={mode}
            onChange={(next) => {
              setMode(next);
              setError(null);
            }}
            options={[
              { value: "files", label: "Upload Files" },
              { value: "paste", label: "Paste CSV" },
            ]}
          />
          {mode === "files" ? (
            <section
              aria-label="Drop zone"
              className="flex min-h-52 flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-surface p-6 text-center text-sm text-muted"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
            >
              <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-neutral-100">
                <FileText className="h-6 w-6 text-ink" aria-hidden="true" />
              </span>
              <p className="font-medium text-ink">
                Drop your files here or{" "}
                <button
                  type="button"
                  className="text-ink underline underline-offset-2"
                  onClick={() => fileInput.current?.click()}
                >
                  browse
                </button>
              </p>
              <p className="mt-1 text-xs">
                Supports CSV, TXT, XLS, XLSX — select several to import them in one go
              </p>
              <input
                ref={fileInput}
                id={ids.file}
                type="file"
                multiple
                accept=".csv,.txt,.xls,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="sr-only"
                onChange={onFileChange}
                data-testid="file-input"
              />
            </section>
          ) : (
            <section className="space-y-2">
              <Label htmlFor={ids.paste}>Paste phone numbers, one per line</Label>
              <p className="text-xs text-muted">
                You can include country codes (e.g. <code className="font-mono">+1234567890</code>)
                and more columns separated by commas.
              </p>
              <Textarea
                id={ids.paste}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                placeholder={"+1234567890\n+4412345678\n+972501234567"}
                className="min-h-40 resize-y font-mono text-xs"
              />
              <div className="flex justify-end">
                <Button onClick={applyPasted} disabled={!pasted.trim()}>
                  <Upload className="h-4 w-4" aria-hidden="true" /> Upload
                </Button>
              </div>
            </section>
          )}
          {errorBox}
        </div>
      </div>
    );
  }

  // Step two: Import <file>.
  const title = files.length === 1 ? `Import ${first.name}` : `Import ${files.length} files`;
  const sizeMb = (totalBytes / 1024 / 1024).toFixed(2);
  const listOptions = [
    { value: NEW_LIST, label: "+ New List" },
    ...lists.map((l) => ({ value: l.id, label: `${l.name} (${l.country})` })),
  ];
  const countrySelectValue = isNew ? countryChoice : (existingList?.country ?? AUTO_COUNTRY);

  return (
    <div>
      {fixedList ? (
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-ink">{title}</h2>
          <p className="text-xs text-muted">
            {formatNumber(totalRows)} rows · {sizeMb} MB
          </p>
        </div>
      ) : (
        <PageHeader
          breadcrumb={[
            { label: "Contacts", href: "/lists" },
            { label: "Upload", href: "/lists/upload" },
            { label: "Import" },
          ]}
          title={title}
          meta={
            <span className="flex gap-3 text-xs">
              <span data-testid="import-rows">{formatNumber(totalRows)} rows</span>
              <span>{sizeMb} MB</span>
            </span>
          }
        />
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Card className="p-5">
            <h2 className="border-b border-rule pb-3 text-sm font-semibold text-ink">Settings</h2>
            <div className="divide-y divide-rule">
              <div className="space-y-4 py-4">
                {fixedList ? (
                  <p className="text-sm text-muted">
                    Numbers are added to{" "}
                    <span className="font-medium text-ink">{fixedList.name}</span>.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor={ids.list}>List</Label>
                    <SimpleSelect
                      aria-label="List"
                      value={listValue}
                      onValueChange={setListValue}
                      options={listOptions}
                      disabled={uploading}
                    />
                  </div>
                )}
                {isNew ? (
                  <div className="space-y-1.5">
                    <Label htmlFor={ids.name}>New List Name</Label>
                    <Input
                      id={ids.name}
                      value={name}
                      onChange={(e) => {
                        setName(e.target.value);
                        setNameTouched(true);
                      }}
                      maxLength={100}
                      disabled={uploading}
                    />
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5 py-4">
                <Label htmlFor={ids.country}>
                  Fixed Country{" "}
                  {isNew ? <span className="font-normal text-red-600">— required</span> : null}
                </Label>
                <SimpleSelect
                  aria-label="Fixed Country"
                  value={countrySelectValue}
                  onValueChange={changeCountry}
                  options={countryOptions}
                  disabled={!isNew || uploading}
                  className={countryError ? "border-red-500 ring-1 ring-red-500" : ""}
                />
                {countryError ? (
                  <p className="text-xs text-red-600" data-testid="country-error">
                    {countryError}
                  </p>
                ) : autoCountry && detectedCountry ? (
                  <p className="text-xs text-muted">
                    Detected {countryByCode(detectedCountry)?.name ?? detectedCountry} from the
                    country column.
                  </p>
                ) : !isNew ? (
                  <p className="text-xs text-muted">The list's country.</p>
                ) : null}
              </div>
              <div className="space-y-4 py-4">
                <div className="flex items-start justify-between gap-4">
                  <label htmlFor={ids.logical} className="text-sm">
                    <span className="block font-medium text-ink">Logical Check</span>
                    <span className="block text-xs text-muted">
                      Remove landline &amp; invalid numbers
                    </span>
                  </label>
                  <Checkbox
                    id={ids.logical}
                    checked={logicalCheck}
                    onCheckedChange={(v) => setLogicalCheck(v === true)}
                    disabled={uploading}
                    className="mt-1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={ids.duplicates}>Duplicates</Label>
                  <SimpleSelect
                    aria-label="Duplicates"
                    value={duplicates}
                    onValueChange={(v) => setDuplicates(v as DuplicateMode)}
                    options={duplicateOptions}
                    disabled={uploading}
                  />
                </div>
              </div>
              <div className="flex items-start justify-between gap-4 pt-4">
                <label htmlFor={ids.flush} className="text-sm">
                  <span className="block font-medium text-ink">Flush after import</span>
                  <span className="block text-xs text-muted">
                    Numbers you've sent to before stay blocked even in a new list — turn this on to
                    make them sendable again
                  </span>
                </label>
                <Checkbox
                  id={ids.flush}
                  checked={flushAfterImport}
                  onCheckedChange={(v) => setFlushAfterImport(v === true)}
                  disabled={uploading}
                  className="mt-1"
                />
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="border-b border-rule pb-3 text-sm font-semibold text-ink">
              File Details
            </h2>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-3 pt-4 text-sm">
              <dt className="text-muted">{files.length === 1 ? "Filename" : "Files"}</dt>
              <dd className="min-w-0">
                <ul className="space-y-1">
                  {files.map((file, index) => (
                    <li key={file.id} className="flex items-center justify-end gap-1">
                      <span className="truncate font-mono text-xs text-ink" title={file.name}>
                        {file.name}
                      </span>
                      {files.length > 1 ? (
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          className="rounded p-0.5 text-muted hover:bg-neutral-100 hover:text-ink"
                          onClick={() => removeFile(index)}
                          disabled={uploading}
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </dd>
              <dt className="text-muted">Rows</dt>
              <dd className="text-right tabular-nums text-ink" data-testid="file-rows">
                {formatNumber(totalRows)}
              </dd>
              <dt className="text-muted">Size</dt>
              <dd className="text-right tabular-nums text-ink">{sizeMb} MB</dd>
              <dt className="text-muted">Number Column</dt>
              <dd className="text-right" data-testid="number-column">
                {phoneSet ? (
                  <Badge variant="success" className="gap-1">
                    <Check className="h-3 w-3" aria-hidden="true" /> Set
                  </Badge>
                ) : (
                  <Badge variant="destructive">Missing</Badge>
                )}
              </dd>
              <dt className="text-muted">
                <label htmlFor={ids.header}>First row is a header</label>
              </dt>
              <dd className="text-right">
                <Checkbox
                  id={ids.header}
                  checked={hasHeader}
                  onCheckedChange={(v) => setHasHeader(v === true)}
                  disabled={uploading}
                />
              </dd>
            </dl>
          </Card>
        </div>

        <Card className="min-w-0 self-start p-5">
          <h2 className="text-sm font-semibold text-ink">Field Types</h2>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
            Select the type for each column.
            <Sparkles className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" /> = auto-detected
          </p>
          <div className="mt-4 overflow-x-auto rounded-md border border-rule">
            <table className="w-full border-collapse text-xs" data-testid="field-types">
              <thead>
                <tr className="bg-neutral-50">
                  <th className="w-10 border-b border-r border-rule" aria-label="Row" />
                  {mapping.map((_, index) => (
                    <th
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                      key={index}
                      className="min-w-44 border-b border-r border-rule px-3 py-2 text-center font-medium text-muted last:border-r-0"
                    >
                      {columnLetter(index)}
                      {hasHeader && columnNames[index] ? (
                        <span className="block truncate font-normal text-neutral-500">
                          {columnNames[index]}
                        </span>
                      ) : null}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="border-b border-r border-rule px-2 text-[10px] font-medium uppercase tracking-wide text-muted">
                    Type
                  </th>
                  {mapping.map((type, index) => {
                    const usedElsewhere = new Set<string>(
                      mapping.filter((t, i) => i !== index && t !== "ignore"),
                    );
                    const auto = type !== "ignore" && detected[index] === type;
                    return (
                      <th
                        // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional.
                        key={index}
                        className="border-b border-r border-rule p-1.5 font-normal last:border-r-0"
                      >
                        <div className="flex items-center gap-1.5">
                          <SimpleSelect
                            aria-label={`Type of column ${columnLetter(index)}`}
                            value={type}
                            onValueChange={(v) => setColumnType(index, v as ColumnType)}
                            options={columnTypeOptions.map((o) => ({
                              ...o,
                              disabled: usedElsewhere.has(o.value),
                            }))}
                            disabled={uploading}
                            className="h-8 flex-1 text-xs"
                          />
                          {auto ? (
                            <Sparkles
                              className="h-4 w-4 shrink-0 text-amber-500"
                              aria-label="Auto-detected"
                            />
                          ) : (
                            <span className="w-4 shrink-0" />
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, r) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no identity.
                  <tr key={r} className="border-b border-rule last:border-b-0">
                    <td className="border-r border-rule px-2 py-2.5 text-center text-[10px] text-muted">
                      {r + 1}
                    </td>
                    {mapping.map((_, c) => (
                      <td
                        // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
                        key={c}
                        className="border-r border-rule px-3 py-2.5 font-mono text-ink last:border-r-0"
                      >
                        {row[c] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalRows > previewRows.length ? (
            <p className="mt-2 text-xs text-muted">
              Showing the first {formatNumber(previewRows.length)} of {formatNumber(totalRows)} rows
              {files.length > 1 ? ` of ${first.name}` : ""}.
            </p>
          ) : null}

          <div className="mt-5 space-y-3">
            {damagedNumbers > 0 ? (
              <p
                role="status"
                data-testid="damaged-warning"
                className="rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber"
              >
                <strong className="font-semibold">
                  {formatNumber(damagedNumbers)} of {formatNumber(totalRows)} numbers were cut short
                  by a spreadsheet program.
                </strong>{" "}
                They look like 4.91516E+12, the missing digits cannot be recovered, and they will be
                rejected. Use the original file, or export it again with the phone column formatted
                as text.
              </p>
            ) : null}
            {errorBox}
            {phase.kind === "uploading" ? (
              <div aria-live="polite">
                <progress
                  className="h-2 w-full"
                  value={phase.done}
                  max={phase.total}
                  aria-label="Import progress"
                />
                <p className="mt-1 text-xs text-neutral-600">
                  {formatNumber(phase.done)} of {formatNumber(phase.total)} rows · {phase.file}
                </p>
              </div>
            ) : null}
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={cancel} disabled={uploading}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={
                  uploading ||
                  !phoneSet ||
                  countryError !== null ||
                  (isNew && name.trim().length === 0)
                }
                data-testid="import-button"
              >
                <Upload className="h-4 w-4" aria-hidden="true" />
                {uploading ? "Importing…" : "Import"}
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Summary({
  listId,
  listName,
  summary,
  files,
}: {
  listId: string;
  listName: string;
  summary: UploadSummary;
  files: number;
}) {
  const good = importedGood(summary);
  const bad = summary.addedBad.landline + summary.addedBad.suspicious;
  return (
    <section className="space-y-4" data-testid="upload-summary">
      <h2 className="text-lg font-semibold">
        Imported into{" "}
        <Link href={`/lists/${listId}`} className="underline">
          {listName}
        </Link>
        {files > 1 ? (
          <span className="ml-2 text-sm font-normal text-muted">({files} files)</span>
        ) : null}
      </h2>
      <p className="text-sm text-muted">
        {formatNumber(summary.rows)} rows → {formatNumber(summary.imported)} added (
        {formatNumber(good)} good, {formatNumber(bad)} bad) · {formatNumber(totalDropped(summary))}{" "}
        rejected · {formatNumber(summary.skippedExisting)} skipped
      </p>
      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <dt className="text-neutral-500">Rows read</dt>
        <dd className="tabular-nums" data-testid="summary-rows">
          {formatNumber(summary.rows)}
        </dd>
        <dt className="text-neutral-500">Added to the list</dt>
        <dd className="font-semibold tabular-nums" data-testid="summary-imported">
          {formatNumber(summary.imported)}
        </dd>
        <dt className="text-neutral-500">Good</dt>
        <dd className="tabular-nums text-good" data-testid="summary-good">
          {formatNumber(good)}
        </dd>
        <dt className="text-neutral-500">Added as Bad</dt>
        <dd className="tabular-nums" data-testid="summary-bad">
          {formatNumber(bad)}
        </dd>
        <dt className="text-neutral-500">Skipped (already in contacts or list)</dt>
        <dd className="tabular-nums" data-testid="summary-skipped">
          {formatNumber(summary.skippedExisting)}
        </dd>
        <dt className="text-neutral-500">Duplicates in file</dt>
        <dd className="tabular-nums" data-testid="summary-duplicates">
          {formatNumber(summary.duplicates)}
        </dd>
        <dt className="text-neutral-500">Rejected</dt>
        <dd className="tabular-nums" data-testid="summary-dropped">
          {formatNumber(totalDropped(summary))}
        </dd>
      </dl>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="text-sm font-medium">Added as Bad, by reason</h3>
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm">
            <dt className="text-neutral-500">Not a mobile number (landline)</dt>
            <dd className="tabular-nums" data-testid="bad-landline">
              {formatNumber(summary.addedBad.landline)}
            </dd>
            <dt className="text-neutral-500">Suspicious digit pattern (likely fake)</dt>
            <dd className="tabular-nums" data-testid="bad-suspicious">
              {formatNumber(summary.addedBad.suspicious)}
            </dd>
          </dl>
        </div>
        <div>
          <h3 className="text-sm font-medium">Rejected by reason</h3>
          <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm">
            {SHOWN_DROP_REASONS.map((reason) => (
              <div key={reason} className="contents">
                <dt className="text-neutral-500">{DROP_REASON_LABELS[reason]}</dt>
                <dd className="tabular-nums" data-testid={`drop-${reason}`}>
                  {formatNumber(summary.dropped[reason])}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="flex gap-3">
        <Button asChild>
          <Link href={`/lists/${listId}`}>Open the list</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/lists/files">See it on the Files page</Link>
        </Button>
      </div>
    </section>
  );
}
