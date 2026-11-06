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
  SimpleSelect,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Textarea,
} from "@sendex/ui";
import Link from "next/link";
import Papa from "papaparse";
import { type ChangeEvent, type DragEvent, useId, useRef, useState } from "react";
import { formatNumber } from "../../../../lib/format";
import { finishUpload, importChunk, startUpload } from "../actions";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PREVIEW_ROWS = 10;
const DETECT_SAMPLE = 50;
const ACCEPTED_EXTENSIONS = ["csv", "txt"];

/** Drop reasons shown in the summary, in order. VoIP is never produced today. */
const SHOWN_DROP_REASONS: readonly DropReason[] = [
  "landline",
  "invalid",
  "unparseable",
  "no_country",
  "premium",
  "toll_free",
];

const columnTypeOptions = COLUMN_TYPES.map((t) => ({ value: t, label: COLUMN_TYPE_LABELS[t] }));
const countryOptions = countriesList.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` }));
const duplicateOptions: ReadonlyArray<{ value: DuplicateMode; label: string }> = [
  { value: "skip_existing", label: "Skip numbers already in my contacts" },
  { value: "allow", label: "Allow (add known numbers to this list too)" },
];

type Phase =
  | { kind: "idle" }
  | { kind: "uploading"; done: number; total: number }
  | { kind: "done"; listId: string; listName: string; summary: UploadSummary };

interface ParsedData {
  source: string;
  rows: string[][];
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function parseText(text: string): string[][] {
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
  return parsed.data.filter((row) => row.some((cell) => cell.trim().length > 0));
}

export function UploadForm({ lists }: { lists: ListNameRow[] }) {
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

  const [data, setData] = useState<ParsedData | null>(null);
  const [pasted, setPasted] = useState("");
  const [hasHeader, setHasHeader] = useState(false);
  const [mapping, setMapping] = useState<ColumnType[]>([]);
  const [mappingTouched, setMappingTouched] = useState(false);
  const [columnNames, setColumnNames] = useState<string[]>([]);

  const [targetKind, setTargetKind] = useState<"new" | "existing">("new");
  const [name, setName] = useState("");
  const [country, setCountry] = useState<ListCountry>("ES");
  const [existingId, setExistingId] = useState(lists[0]?.id ?? "");
  const [logicalCheck, setLogicalCheck] = useState(true);
  const [duplicates, setDuplicates] = useState<DuplicateMode>("skip_existing");
  const [flushAfterImport, setFlushAfterImport] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const existingList = lists.find((l) => l.id === existingId);
  const effectiveCountry = targetKind === "existing" ? existingList?.country : country;

  function applyDetection(rows: string[][], forCountry: string | undefined) {
    const [first, ...rest] = rows;
    if (!first) return;
    const detected = detectColumns(
      first,
      rest.slice(0, DETECT_SAMPLE),
      forCountry as ListCountry | undefined,
    );
    setHasHeader(detected.hasHeader);
    setMapping(detected.columns.map((c) => c.type));
    setColumnNames(detected.columns.map((c) => c.name));
    setMappingTouched(false);
  }

  function loadRows(rows: string[][], source: string) {
    if (rows.length === 0) {
      setError("No rows found.");
      return;
    }
    setError(null);
    setPhase({ kind: "idle" });
    setData({ source, rows });
    applyDetection(rows, effectiveCountry);
  }

  async function loadFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!ACCEPTED_EXTENSIONS.includes(extension)) {
      setError(`Only .csv and .txt files are accepted (got "${file.name}").`);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is 10 MB.`);
      return;
    }
    loadRows(parseText(await file.text()), file.name);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void loadFile(file);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  }

  function applyPasted() {
    loadRows(parseText(pasted), "pasted text");
  }

  function changeCountry(value: string) {
    const next = value as ListCountry;
    setCountry(next);
    if (data && !mappingTouched) applyDetection(data.rows, next);
  }

  function setColumnType(index: number, type: ColumnType) {
    setMappingTouched(true);
    setMapping((current) => current.map((t, i) => (i === index ? type : t)));
  }

  const dataRows = data ? (hasHeader ? data.rows.slice(1) : data.rows) : [];
  const previewRows = dataRows.slice(0, PREVIEW_ROWS);

  async function submit() {
    if (!data) return;
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

    const batches = chunk(dataRows, UPLOAD_CHUNK_SIZE);
    setPhase({ kind: "uploading", done: 0, total: dataRows.length });
    const started = await startUpload(settingsInput);
    if (!started.ok) {
      setError(started.error);
      setPhase({ kind: "idle" });
      return;
    }

    let summary = emptyUploadSummary();
    let done = 0;
    for (const batch of batches) {
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
          `${result.error} (${formatNumber(done)} of ${formatNumber(dataRows.length)} rows processed)`,
        );
        setPhase({ kind: "idle" });
        return;
      }
      summary = addUploadSummary(summary, result.data);
      summary.rows += blank;
      summary.dropped.unparseable += blank;
      done += batch.length;
      setPhase({ kind: "uploading", done, total: dataRows.length });
    }

    const finished = await finishUpload({
      listId: started.data.listId,
      logicalCheck,
      duplicates,
      flushAfterImport,
      summary,
    });
    if (!finished.ok) {
      setError(finished.error);
      setPhase({ kind: "idle" });
      return;
    }
    setPhase({ kind: "done", listId: started.data.listId, listName: started.data.name, summary });
  }

  if (phase.kind === "done") {
    return <Summary listId={phase.listId} listName={phase.listName} summary={phase.summary} />;
  }

  const uploading = phase.kind === "uploading";

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2">
        <section
          aria-label="Drop zone"
          className="flex min-h-40 flex-col items-center justify-center rounded-md border-2 border-dashed border-neutral-300 bg-white p-6 text-center text-sm text-neutral-600"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <p>Drag a .csv or .txt file here</p>
          <p className="mt-1 text-xs text-neutral-500">up to 10 MB</p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
          >
            Choose file
          </Button>
          <input
            ref={fileInput}
            id={ids.file}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={onFileChange}
            data-testid="file-input"
          />
        </section>
        <section className="space-y-2">
          <Label htmlFor={ids.paste}>Or paste numbers, one per line</Label>
          <Textarea
            id={ids.paste}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder={"+34 600 123 456\n+34 600 123 457"}
            className="min-h-32 font-mono text-xs"
            disabled={uploading}
          />
          <Button variant="outline" onClick={applyPasted} disabled={uploading || !pasted.trim()}>
            Use pasted data
          </Button>
        </section>
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      ) : null}

      {data ? (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              Columns{" "}
              <span className="text-sm font-normal text-neutral-500">
                {formatNumber(dataRows.length)} rows from {data.source}
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
                Drop landlines, premium and toll-free numbers.
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
        <Button onClick={submit} disabled={!data || uploading} data-testid="import-button">
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
              {formatNumber(phase.done)} of {formatNumber(phase.total)} rows
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
}: {
  listId: string;
  listName: string;
  summary: UploadSummary;
}) {
  return (
    <section className="space-y-4" data-testid="upload-summary">
      <h2 className="text-lg font-semibold">
        Imported into{" "}
        <Link href={`/lists/${listId}`} className="underline">
          {listName}
        </Link>
      </h2>
      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <dt className="text-neutral-500">Rows read</dt>
        <dd className="tabular-nums" data-testid="summary-rows">
          {formatNumber(summary.rows)}
        </dd>
        <dt className="text-neutral-500">Imported</dt>
        <dd className="font-semibold tabular-nums" data-testid="summary-imported">
          {formatNumber(summary.imported)}
        </dd>
        <dt className="text-neutral-500">Skipped (already in contacts or list)</dt>
        <dd className="tabular-nums" data-testid="summary-skipped">
          {formatNumber(summary.skippedExisting)}
        </dd>
        <dt className="text-neutral-500">Duplicates in file</dt>
        <dd className="tabular-nums" data-testid="summary-duplicates">
          {formatNumber(summary.duplicates)}
        </dd>
        <dt className="text-neutral-500">Dropped</dt>
        <dd className="tabular-nums" data-testid="summary-dropped">
          {formatNumber(totalDropped(summary))}
        </dd>
      </dl>
      <div>
        <h3 className="text-sm font-medium">Dropped by reason</h3>
        <dl className="mt-1 grid gap-x-6 gap-y-1 text-sm md:grid-cols-3">
          {SHOWN_DROP_REASONS.map((reason) => (
            <div
              key={reason}
              className="flex justify-between gap-2 border-b border-neutral-100 py-1"
            >
              <dt className="text-neutral-500">{DROP_REASON_LABELS[reason]}</dt>
              <dd className="tabular-nums" data-testid={`drop-${reason}`}>
                {formatNumber(summary.dropped[reason])}
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex gap-2">
        <Link
          href={`/lists/${listId}`}
          className="inline-flex h-9 items-center rounded-md bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700"
        >
          View list
        </Link>
        <Link
          href="/lists"
          className="inline-flex h-9 items-center rounded-md border border-neutral-300 bg-white px-4 text-sm font-medium hover:bg-neutral-100"
        >
          Back to lists
        </Link>
      </div>
    </section>
  );
}
