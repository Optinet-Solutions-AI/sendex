"use client";

import { countryName, countryOptions, flagEmoji, SENDER_MODES, TEXT_PRESETS } from "@sendex/core";
import {
  Badge,
  Button,
  Card,
  cn,
  IconButton,
  PaginationBar,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toggle,
  Tooltip,
  useToast,
} from "@sendex/ui";
import { Plus, Receipt, RefreshCw, Send, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { removeSmsTestAction } from "../../app/(dashboard)/routes/actions";
import { formatDateTime } from "../../lib/format";
import { type RoutesQuery, routesQueryString } from "../../lib/routes-params";
import { eur, int, pct } from "../dashboard/format";
import { SendSingleDialog } from "./send-single-dialog";

export interface SmsTestView {
  id: string;
  type: string;
  country: string;
  routeNames: string[];
  senderModes: string[];
  customSender: string | null;
  textPresets: string[];
  recipient: string | null;
  scheduled: boolean;
  testsRan: number;
  successCount: number;
  costMicro: number;
  queueStatus: string;
  createdAt: string;
  lastSentAt: string | null;
  removedAt: string | null;
}

export interface CostMonthView {
  month: string;
  tests: number;
  messages: number;
  costMicro: number;
}

const STATUS_VARIANT: Record<
  string,
  "secondary" | "warning" | "success" | "destructive" | "active"
> = {
  queued: "warning",
  scheduled: "active",
  running: "warning",
  done: "success",
  failed: "destructive",
};

function senderLabel(modes: string[], custom: string | null): string {
  return modes
    .map((m) =>
      m === "custom" ? (custom ?? "Custom") : (SENDER_MODES.find((s) => s.key === m)?.label ?? m),
    )
    .join(", ");
}

function presetLabel(presets: string[]): string {
  return presets.map((p) => TEXT_PRESETS.find((t) => t.key === p)?.label ?? p).join(", ");
}

/** Routes › Testing: the SMS Tests table, Cost Report, + Test SMS and ➤ Send Single. */
export function Testing({
  query,
  rows,
  total,
  pageSize,
  costReport,
  canSend,
}: {
  query: RoutesQuery;
  rows: SmsTestView[];
  total: number;
  pageSize: number;
  costReport: CostMonthView[];
  canSend: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [dialog, setDialog] = useState<"single" | "test" | null>(null);
  const [refreshing, startRefresh] = useTransition();
  const [, start] = useTransition();
  const go = (next: Partial<RoutesQuery>) =>
    router.push(`/routes/testing${routesQueryString({ ...query, page: 1, ...next })}`);
  const remove = (id: string) =>
    start(async () => {
      const result = await removeSmsTestAction({ id });
      if (!result.ok) toast({ title: result.error, variant: "error" });
      else router.refresh();
    });
  return (
    <div className="space-y-4" data-testid="sms-tests">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Country"
          className="h-9 rounded-md border border-neutral-300 bg-surface px-3 text-sm"
          value={query.countries[0] ?? ""}
          onChange={(e) => go({ countries: e.target.value ? [e.target.value] : [] })}
        >
          <option value="">Any country</option>
          {countryOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => go({ showRemoved: !query.showRemoved })}
          className={cn("text-sm", query.showRemoved ? "text-ink underline" : "text-muted")}
          data-testid="show-removed"
        >
          show removed
        </button>
        <Button variant="outline" size="sm" onClick={() => startRefresh(() => router.refresh())}>
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />{" "}
          Refresh
        </Button>
        <div className="ml-auto flex items-center gap-3">
          <Toggle
            label="Singles"
            checked={query.singlesOnly}
            onCheckedChange={(v) => go({ singlesOnly: v })}
            testId="singles-toggle"
          />
          <span className="text-sm text-muted">Schedule Sending</span>
        </div>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-4 py-2 text-sm text-muted">
          <span data-testid="tests-count">
            {total === 0
              ? "Showing 0-0 of 0 items"
              : `Showing ${(query.page - 1) * pageSize + 1}-${Math.min(total, query.page * pageSize)} of ${int(total)} items`}
          </span>
          <div className="flex items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" data-testid="cost-report">
                  <Receipt className="h-4 w-4" aria-hidden="true" /> Cost Report
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80">
                <div className="mb-1 text-sm font-semibold">Tests cost per month</div>
                {costReport.length === 0 ? (
                  <p className="text-xs text-muted">No tests yet.</p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="text-left font-mono text-[11px] uppercase text-muted">
                      <tr>
                        <th className="py-1">Month</th>
                        <th className="py-1 text-right">Tests</th>
                        <th className="py-1 text-right">SMS</th>
                        <th className="py-1 text-right">Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {costReport.map((m) => (
                        <tr key={m.month}>
                          <td className="py-0.5">{m.month}</td>
                          <td className="py-0.5 text-right tabular-nums">{m.tests}</td>
                          <td className="py-0.5 text-right tabular-nums">{m.messages}</td>
                          <td className="py-0.5 text-right tabular-nums">{eur(m.costMicro)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </PopoverContent>
            </Popover>
            <Tooltip content="Send to real test handsets and get a delivery verdict per route.">
              <Button
                size="sm"
                onClick={() => setDialog("test")}
                disabled={!canSend}
                data-testid="open-test-sms"
              >
                <Plus className="h-4 w-4" aria-hidden="true" /> Test SMS
              </Button>
            </Tooltip>
            <Tooltip content="Send one message to a number you enter, e.g. your own handset.">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDialog("single")}
                disabled={!canSend}
                data-testid="open-send-single"
              >
                <Send className="h-4 w-4" aria-hidden="true" /> Send Single
              </Button>
            </Tooltip>
          </div>
        </div>
        <Table data-testid="tests-table">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>ID</TableHead>
              <TableHead className="text-right">Tests Ran</TableHead>
              <TableHead className="text-right">Success Rate</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Routes</TableHead>
              <TableHead>Sender ID (From)</TableHead>
              <TableHead>Recipient (To)</TableHead>
              <TableHead>Text Preset</TableHead>
              <TableHead>Created / Last Sent</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead>Queue Status</TableHead>
              <TableHead>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={12} className="py-10 text-center text-muted">
                  No tests yet. Hit <span className="font-medium text-ink">Test SMS</span> to run
                  one.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.id}
                  data-testid="test-row"
                  data-status={r.queueStatus}
                  className={r.removedAt ? "opacity-60" : ""}
                >
                  <TableCell className="font-mono text-xs">{r.id.slice(0, 8)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {int(r.testsRan)}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {r.testsRan > 0 ? pct(r.successCount / r.testsRan, 0) : "—"}
                  </TableCell>
                  <TableCell>
                    <span aria-hidden="true">{flagEmoji(r.country)}</span> {countryName(r.country)}
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate" title={r.routeNames.join(", ")}>
                    {r.routeNames.join(", ")}
                  </TableCell>
                  <TableCell className="max-w-[10rem] truncate">
                    {senderLabel(r.senderModes, r.customSender)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{r.recipient ?? "handsets"}</TableCell>
                  <TableCell className="max-w-[10rem] truncate" title={presetLabel(r.textPresets)}>
                    {presetLabel(r.textPresets)}
                  </TableCell>
                  <TableCell className="text-xs text-muted">
                    {formatDateTime(r.createdAt)}
                    <br />
                    {r.lastSentAt ? formatDateTime(r.lastSentAt) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {eur(r.costMicro)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[r.queueStatus] ?? "secondary"}>
                      {r.queueStatus}
                      {r.scheduled ? " · scheduled" : ""}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {r.removedAt ? null : (
                      <IconButton
                        label={`Remove test ${r.id.slice(0, 8)}`}
                        tooltip="Remove"
                        icon={<Trash2 />}
                        tone="danger"
                        disabled={!canSend}
                        onClick={() => remove(r.id)}
                        data-testid="test-remove"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <div className="border-t border-rule px-4 py-2">
          <PaginationBar
            style="page-of"
            page={query.page}
            pageSize={pageSize}
            total={total}
            onPageChange={(page) =>
              router.push(`/routes/testing${routesQueryString({ ...query, page })}`)
            }
          />
        </div>
      </Card>
      {dialog ? <SendSingleDialog mode={dialog} open onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
