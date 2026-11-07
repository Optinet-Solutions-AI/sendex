"use client";

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Textarea,
  useToast,
} from "@sendex/ui";
import { Plus, RotateCcw, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";
import { type ChangeEvent, useId, useState, useTransition } from "react";
import * as XLSX from "xlsx";
import {
  addSuppressionNumbersAction,
  importSuppressionsAction,
  resubscribeAction,
} from "../../app/(dashboard)/unsubscribes/actions";
import { formatNumber } from "../../lib/format";
import { ErrorText, inputClass } from "../campaigns/ui";

function splitNumbers(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** "+ Add number" and "Resubscribe" share one dialog: a textarea of numbers, one per line. */
function NumbersDialog({
  mode,
  open,
  onClose,
}: {
  mode: "add" | "resubscribe";
  open: boolean;
  onClose: () => void;
}) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const numbers = splitNumbers(text);

  function submit() {
    setError(null);
    start(async () => {
      if (mode === "add") {
        const result = await addSuppressionNumbersAction(numbers);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast({
          title: `${formatNumber(result.data.added)} number${result.data.added === 1 ? "" : "s"} unsubscribed`,
          ...(result.data.rejected.length > 0
            ? {
                description: `${result.data.rejected.length} could not be read: ${result.data.rejected.slice(0, 3).join(", ")}`,
              }
            : {}),
          variant: "success",
        });
      } else {
        const result = await resubscribeAction(numbers);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        toast({
          title: `${formatNumber(result.data.removed)} number${result.data.removed === 1 ? "" : "s"} resubscribed`,
          variant: "success",
        });
      }
      setText("");
      onClose();
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {mode === "add" ? "Add number" : "Resubscribe"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          {mode === "add"
            ? "Numbers in international format, one per line. They are never contacted again on this account, starting now."
            : "Numbers in international format, one per line. They leave the unsubscribe list and can be sent to again."}
        </DialogDescription>
        <form
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label htmlFor={`${id}-numbers`} className="sr-only">
            Numbers
          </label>
          <Textarea
            id={`${id}-numbers`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"+34622000001\n+447700900123"}
            className="min-h-32 font-mono text-xs"
            data-testid={`${mode}-numbers`}
          />
          <ErrorText error={error} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={pending || numbers.length === 0}
              data-testid={`${mode}-submit`}
            >
              {mode === "add" ? "Unsubscribe" : "Resubscribe"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ParsedSheet {
  fileName: string;
  rows: string[][];
}

/** "Upload unsubscribes": CSV, XLS or XLSX, then pick the column that holds the numbers. */
function UploadDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const id = useId();
  const router = useRouter();
  const { toast } = useToast();
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [column, setColumn] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    let rows: string[][];
    if (extension === "xls" || extension === "xlsx") {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
      const name = workbook.SheetNames[0];
      const ws = name ? workbook.Sheets[name] : undefined;
      rows = ws
        ? XLSX.utils
            .sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" })
            .map((r) => r.map((c) => String(c ?? "")))
        : [];
    } else if (extension === "csv" || extension === "txt") {
      rows = Papa.parse<string[]>(await file.text(), { skipEmptyLines: "greedy" }).data;
    } else {
      setError("CSV, XLS or XLSX only.");
      return;
    }
    rows = rows.filter((r) => r.some((c) => c.trim() !== ""));
    if (rows.length === 0) {
      setError("The file is empty.");
      return;
    }
    const width = Math.max(...rows.map((r) => r.length));
    // Guess the column: the one with the most digit-heavy cells.
    let best = 0;
    let bestScore = -1;
    for (let c = 0; c < width; c += 1) {
      const score = rows.filter((r) => /\d{7,}/.test(r[c] ?? "")).length;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    setColumn(best);
    setSheet({ fileName: file.name, rows });
  }

  function submit() {
    if (!sheet) return;
    setError(null);
    start(async () => {
      const result = await importSuppressionsAction({
        fileName: sheet.fileName,
        numbers: sheet.rows.map((r) => r[column] ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: `${formatNumber(result.data.added)} numbers unsubscribed from ${sheet.fileName}`,
        ...(result.data.rejected > 0
          ? { description: `${formatNumber(result.data.rejected)} rows could not be read.` }
          : {}),
        variant: "success",
      });
      setSheet(null);
      onClose();
      router.refresh();
    });
  }

  const width = sheet ? Math.max(...sheet.rows.map((r) => r.length)) : 0;
  const preview = sheet ? sheet.rows.slice(0, 5) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setSheet(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogTitle className="text-lg font-semibold">Upload unsubscribes</DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          CSV, XLS or XLSX. After the upload you pick which column holds the numbers, then the file
          is imported as a suppression list.
        </DialogDescription>
        <div className="mt-4 space-y-3">
          <label htmlFor={`${id}-file`} className="block text-sm font-medium text-ink">
            File
          </label>
          <input
            id={`${id}-file`}
            type="file"
            accept=".csv,.txt,.xls,.xlsx"
            onChange={(e) => void onFile(e)}
            className="block w-full text-sm"
            data-testid="unsub-file"
          />
          {sheet ? (
            <>
              <p className="text-xs text-muted">
                {sheet.fileName}: {formatNumber(sheet.rows.length)} rows
              </p>
              <label htmlFor={`${id}-column`} className="block text-sm font-medium text-ink">
                Column with the numbers
              </label>
              <select
                id={`${id}-column`}
                className={inputClass}
                value={column}
                onChange={(e) => setColumn(Number(e.target.value))}
                data-testid="unsub-column"
              >
                {Array.from({ length: width }, (_, c) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: spreadsheet columns are positional.
                  <option key={`col-${c + 1}`} value={c}>
                    Column {c + 1}:{" "}
                    {preview
                      .map((r) => r[c] ?? "")
                      .filter(Boolean)
                      .slice(0, 2)
                      .join(", ")}
                  </option>
                ))}
              </select>
            </>
          ) : null}
          <ErrorText error={error} />
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSheet(null);
                onClose();
              }}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button onClick={submit} disabled={pending || !sheet} data-testid="unsub-upload-submit">
              <Upload className="h-4 w-4" aria-hidden="true" /> Upload
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The three header buttons of the Unsubscribe page and their dialogs. */
export function UnsubscribeActions() {
  const [dialog, setDialog] = useState<"add" | "resubscribe" | "upload" | null>(null);
  return (
    <>
      <Button variant="outline" onClick={() => setDialog("resubscribe")}>
        <RotateCcw className="h-4 w-4" aria-hidden="true" /> Resubscribe
      </Button>
      <Button variant="outline" onClick={() => setDialog("add")}>
        <Plus className="h-4 w-4" aria-hidden="true" /> Add number
      </Button>
      <Button onClick={() => setDialog("upload")}>
        <Upload className="h-4 w-4" aria-hidden="true" /> Upload unsubscribes
      </Button>
      <NumbersDialog mode="add" open={dialog === "add"} onClose={() => setDialog(null)} />
      <NumbersDialog
        mode="resubscribe"
        open={dialog === "resubscribe"}
        onClose={() => setDialog(null)}
      />
      <UploadDialog open={dialog === "upload"} onClose={() => setDialog(null)} />
    </>
  );
}
