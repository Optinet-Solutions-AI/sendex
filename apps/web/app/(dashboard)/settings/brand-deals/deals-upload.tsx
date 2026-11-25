"use client";

import { dealSheetColumns } from "@sendex/core";
import { Button, Card, CardHeader } from "@sendex/ui";
import Papa from "papaparse";
import { useId, useRef, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { type UploadSummary, uploadBrandDealsAction } from "./actions";

const MAX_FILE_BYTES = 5 * 1024 * 1024;

/** The file's first sheet as rows of text; dates in Excel come out as YYYY-MM-DD. */
async function readRows(file: File): Promise<string[][]> {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "xls" || extension === "xlsx") {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
    const name = workbook.SheetNames[0];
    const sheet = name ? workbook.Sheets[name] : undefined;
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      raw: false,
      defval: "",
      dateNF: "yyyy-mm-dd",
    });
    return rows.map((row) => row.map((cell) => String(cell ?? "")));
  }
  return Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" }).data;
}

/**
 * Upload the Media Deals export (CSV or Excel). Only the deal columns leave the browser:
 * the export's contacts and logins are dropped here. Prices apply from the chosen day, or
 * from a row's own date when the file has a date column.
 */
export function DealsUpload({ today }: { today: string }) {
  const id = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [startsOn, setStartsOn] = useState(today);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<UploadSummary | null>(null);
  const [pending, start] = useTransition();

  function upload() {
    if (!file) return;
    setError(null);
    setSummary(null);
    start(async () => {
      if (file.size > MAX_FILE_BYTES) {
        setError(`${file.name} is over 5 MB.`);
        return;
      }
      let rows: string[][] | null;
      try {
        rows = dealSheetColumns(await readRows(file));
      } catch {
        setError(`${file.name} could not be read. Upload a CSV or Excel file.`);
        return;
      }
      if (!rows) {
        setError('No "ALL BRANDS" and "Deal" columns found. Upload the Media Deals export.');
        return;
      }
      const result = await uploadBrandDealsAction({ startsOn, fileName: file.name, rows });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSummary(result.data);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  return (
    <Card>
      <CardHeader title="Upload deals" note="Media Deals export, CSV or Excel" />
      <form
        className="flex flex-wrap items-end gap-4 px-4 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          upload();
        }}
      >
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-file`}>
          <span className="font-medium text-ink">File</span>
          <input
            id={`${id}-file`}
            ref={fileInput}
            type="file"
            accept=".csv,.txt,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="text-sm"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-from`}>
          <span className="font-medium text-ink">Prices apply from</span>
          <input
            id={`${id}-from`}
            type="date"
            value={startsOn}
            onChange={(e) => setStartsOn(e.target.value)}
            className="h-9 rounded-md border border-rule bg-surface px-2 text-sm"
            required
          />
        </label>
        <Button type="submit" size="sm" disabled={pending || !file || startsOn === ""}>
          {pending ? "Uploading…" : "Upload"}
        </Button>
        <p className="basis-full text-xs text-muted">
          A row with its own date (a &quot;Start Date&quot; column) starts that day instead.
          Uploading a brand again for the same day replaces it; earlier days stay, so earlier
          deposits keep their price. Logins and contacts in the export are not sent.
        </p>
      </form>
      {error ? (
        <p role="alert" className="px-4 pb-4 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {summary ? (
        <div className="space-y-1 px-4 pb-4 text-sm" data-testid="deals-upload-summary">
          <p>
            {summary.saved} deals saved, {summary.priced} with a euro CPA. {summary.earning} first
            deposits now earn revenue.
          </p>
          {summary.problems.length > 0 ? (
            <ul className="list-disc pl-5 text-xs text-muted">
              {summary.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </Card>
  );
}
