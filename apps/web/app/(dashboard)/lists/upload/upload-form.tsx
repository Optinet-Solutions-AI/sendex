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
  DROP_REASON_LABELS,
  type DropReason,
  type DuplicateMode,
  detectColumns,
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
  Button,
  Checkbox,
  Input,
  Label,
  SegmentedControl,
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@sendex/ui";
import { FileText, Upload, X } from "lucide-react";
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
  "unparseable",
  "no_country",
  "premium",
  "toll_free",
  "landline",
];

const columnTypeOptions = COLUMN_TYPES.map((t) => ({ value: t, label: COLUMN_TYPE_LABELS[t] }));
const countryOptions = countriesList.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` }));
const duplicateOptions: ReadonlyArray<{ value: DuplicateMode; label: string }> = [
  { value: "skip_existing", label: "Skip numbers already in my contacts" },
  { value: "allow", label: "Allow (add known numbers to this list too)" },
];

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
 * Upload Contacts of the spec: a segmented switch Upload Files (CSV, TXT, XLS, XLSX, several at
 * once) or Paste CSV, then the column mapping, the target list and the settings. Every file
 * becomes its own import job on the Files page; the summary at the end sums them up.
 */
export function UploadForm({
  lists,
  fixedList,
}: {
  lists: ListNameRow[];
  /** Data Files tab: upload straight into this list (no target choice). */
  fixedList?: { id: string; name: string; country: string };
}) {
  const ids = {
    file: useId(),
    paste: useId(),
    name: useId(),
    country: useId(),
    existing: useId(),
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
  const [mappingTouched, setMappingTouched] = useState(false);
  const [columnNames, setColumnNames] = useState<string[]>([]);

  const [targetKind, setTargetKind] = useState<"new" | "existing">(fixedList ? "existing" : "new");
  const [name, setName] = useState("");
  const [country, setCountry] = useState<ListCountry>("ES");
  const [existingId, setExistingId] = useState(fixedList?.id ?? lists[0]?.id ?? "");
  const [logicalCheck, setLogicalCheck] = useState(true);
  const [duplicates, setDuplicates] = useState<DuplicateMode>("skip_existing");
  const [flushAfterImport, setFlushAfterImport] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const existingList = fixedList ?? lists.find((l) => l.id === existingId);
  const effectiveCountry = targetKind === "existing" ? existingList?.country : country;
  const first = files[0];

  function applyDetection(rows: string[][], forCountry: string | undefined) {
    const [head, ...rest] = rows;
    if (!head) return;
    const detected = detectColumns(
      head,
      rest.slice(0, DETECT_SAMPLE),
      forCountry as ListCountry | undefined,
    );
    setHasHeader(detected.hasHeader);
    setMapping(detected.columns.map((c) => c.type));
    setColumnNames(detected.columns.map((c) => c.name));
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
    setFiles((current) => {
      const next = [...current, ...usable];
      if (current.length === 0 && usable[0]) applyDetection(usable[0].rows, effectiveCountry);
      return next;
    });
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
    return { id: crypto.randomUUID(), name: file.name, source: "file", rows };
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
    setFiles([]);
    addFiles([
      { id: crypto.randomUUID(), name: "pasted text", source: "paste", rows: parseText(pasted) },
    ]);
  }

  function removeFile(index: number) {
    setFiles((current) => {
      const next = current.filter((_, i) => i !== index);
      if (index === 0 && next[0]) applyDetection(next[0].rows, effectiveCountry);
      return next;
    });
  }

  function changeCountry(value: string) {
    const next = value as ListCountry;
    setCountry(next);
    if (first && !mappingTouched) applyDetection(first.rows, next);
  }

  function setColumnType(index: number, type: ColumnType) {
    setMappingTouched(true);
    setMapping((current) => current.map((t, i) => (i === index ? type : t)));
  }

  const dataRowsOf = (file: ParsedFile) => (hasHeader ? file.rows.slice(1) : file.rows);
  const totalRows = files.reduce((sum, f) => sum + dataRowsOf(f).length, 0);
  const previewRows = first ? dataRowsOf(first).slice(0, PREVIEW_ROWS) : [];

  async function submit() {
    if (files.length === 0) return;
    setError(null);
    const mappingResult = ColumnMappingSchema.safeParse(mapping);
    if (!mappingResult.success) {
      setError(mappingResult.error.issues[0]?.message ?? "Fix the column mapping.");
      return;
    }
    const settingsInput: UploadSettingsInput = {
      target:
        targetKind === "new"
          ? { kind: "new", name: name.trim(), country }
          : { kind: "existing", listId: existingId },
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

  return (
    <div className="space-y-8">
      <SegmentedControl
        label="Upload mode"
        value={mode}
        onChange={(next) => {
          setMode(next);
          setFiles([]);
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
          className="flex min-h-44 flex-col items-center justify-center rounded-lg border-2 border-dashed border-neutral-300 bg-surface p-6 text-center text-sm text-muted"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <FileText className="mb-2 h-8 w-8 text-muted" aria-hidden="true" />
          <p className="text-ink">
            Drop your files here or{" "}
            <button
              type="button"
              className="font-medium text-navy underline-offset-2 hover:underline"
              onClick={() => fileInput.current?.click()}
              disabled={uploading}
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
            You can include country codes (e.g. <code className="font-mono">+1234567890</code>).
          </p>
          <Textarea
            id={ids.paste}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"+1234567890\n+4412345678\n+972501234567"}
            className="min-h-40 resize-y font-mono text-xs"
            disabled={uploading}
          />
          <div className="flex justify-end">
            <Button onClick={applyPasted} disabled={uploading || !pasted.trim()}>
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload
            </Button>
          </div>
        </section>
      )}

      {files.length > 0 && mode === "files" ? (
        <ul className="divide-y divide-rule rounded-md border border-rule bg-surface text-sm">
          {files.map((file, index) => (
            <li key={file.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-4 w-4 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate font-medium text-ink">{file.name}</span>
              <span className="font-mono text-xs text-muted">
                {formatNumber(dataRowsOf(file).length)} rows
              </span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                className="rounded p-1 text-muted hover:bg-neutral-100 hover:text-ink"
                onClick={() => removeFile(index)}
                disabled={uploading}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      {first ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              Columns{" "}
              <span className="text-sm font-normal text-neutral-500">
                {formatNumber(totalRows)} rows from{" "}
                {files.length === 1 ? first.name : `${files.length} files`}
              </span>
            </h2>
            <label htmlFor={ids.header} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={ids.header}
                checked={hasHeader}
                onCheckedChange={(v) => setHasHeader(v === true)}
              />
              First row is a header
            </label>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                {mapping.map((type, index) => (
                  <TableHead key={columnNames[index] ?? index} className="min-w-40 normal-case">
                    <div className="space-y-1 py-1">
                      <span className="block truncate text-neutral-700">
                        {columnNames[index] ?? `Column ${index + 1}`}
                      </span>
                      <SimpleSelect
                        aria-label={`Type of column ${index + 1}`}
                        value={type}
                        onValueChange={(v) => setColumnType(index, v as ColumnType)}
                        options={columnTypeOptions}
                        className="h-8 text-xs"
                      />
                    </div>
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewRows.map((row, r) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: preview rows have no identity.
                <TableRow key={r}>
                  {mapping.map((_, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional.
                    <TableCell key={c} className="font-mono text-xs">
                      {row[c] ?? ""}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Settings</h2>
        {fixedList ? (
          <p className="text-sm text-muted">
            Numbers are added to <span className="font-medium text-ink">{fixedList.name}</span> and
            checked against its country ({fixedList.country}).
          </p>
        ) : (
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Target list</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="target"
                  value="new"
                  checked={targetKind === "new"}
                  onChange={() => setTargetKind("new")}
                />
                New list
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="target"
                  value="existing"
                  checked={targetKind === "existing"}
                  onChange={() => setTargetKind("existing")}
                  disabled={lists.length === 0}
                />
                Existing list
              </label>
            </div>
            {targetKind === "new" ? (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor={ids.name}>List name</Label>
                  <Input
                    id={ids.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={100}
                    placeholder="Roy Boy_ES_14092026_Batch2"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor={ids.country}>Country</Label>
                  <SimpleSelect
                    aria-label="Country"
                    value={country}
                    onValueChange={changeCountry}
                    options={countryOptions}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1 md:w-1/2">
                <Label htmlFor={ids.existing}>List</Label>
                <SimpleSelect
                  aria-label="Existing list"
                  value={existingId}
                  onValueChange={setExistingId}
                  options={lists.map((l) => ({ value: l.id, label: `${l.name} (${l.country})` }))}
                />
                <p className="text-xs text-neutral-500">
                  Numbers are checked against the list's country.
                </p>
              </div>
            )}
          </fieldset>
        )}

        <div className="grid gap-3 md:grid-cols-2">
          <label htmlFor={ids.logical} className="flex items-start gap-2 text-sm">
            <Checkbox
              id={ids.logical}
              checked={logicalCheck}
              onCheckedChange={(v) => setLogicalCheck(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Logical check</span>
              <span className="block text-xs text-neutral-500">
                Landlines and suspicious digit patterns are kept but marked Bad (never sent to);
                premium and toll-free numbers are rejected.
              </span>
            </span>
          </label>
          <label htmlFor={ids.flush} className="flex items-start gap-2 text-sm">
            <Checkbox
              id={ids.flush}
              checked={flushAfterImport}
              onCheckedChange={(v) => setFlushAfterImport(v === true)}
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Flush after import</span>
              <span className="block text-xs text-neutral-500">
                Make every number in the list available to send again.
              </span>
            </span>
          </label>
          <div className="space-y-1">
            <Label htmlFor={ids.duplicates}>Duplicates</Label>
            <SimpleSelect
              aria-label="Duplicates"
              value={duplicates}
              onValueChange={(v) => setDuplicates(v as DuplicateMode)}
              options={duplicateOptions}
            />
          </div>
        </div>
      </section>

      <div className="flex items-center gap-4">
        <Button
          onClick={submit}
          disabled={files.length === 0 || uploading}
          data-testid="import-button"
        >
          {uploading ? "Importing…" : "Import"}
        </Button>
        {phase.kind === "uploading" ? (
          <div className="flex-1" aria-live="polite">
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
