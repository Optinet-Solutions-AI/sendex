"use client";

import {
  countryName,
  countryOptions,
  expandTestCombos,
  SENDER_MODES,
  type SenderMode,
  TEXT_PRESETS,
  type TextPreset,
  TIME_SLOTS,
  testCostEstimate,
  WEEKDAYS,
} from "@sendex/core";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Toggle,
  Tooltip,
  useToast,
} from "@sendex/ui";
import { Info, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState, useTransition } from "react";
import {
  createSmsTestAction,
  type RouteChoice,
  routesForCountryAction,
} from "../../app/(dashboard)/routes/actions";
import { ErrorText, inputClass } from "../campaigns/ui";
import { eur } from "../dashboard/format";

const DOT = ["bg-[#2a78d6]", "bg-[#eb6834]", "bg-[#1baf7a]", "bg-[#6250d6]"];

export interface SendSingleFormProps {
  /** `single` is Send Single SMS; `test` is Test SMS (handsets, needs a test-network provider). */
  mode: "single" | "test";
  /** Preselects the destination (the campaign page passes its country). */
  country?: string;
  onDone?: () => void;
  onCancel?: () => void;
}

/**
 * The Send Single SMS form of the spec (also the body of the Test SMS dialog): destination
 * country, recipient, routes, Schedule Sending (days and 15-minute UTC slots), sender id
 * modes, text presets, hypothesis, jitter, cascade and the cost estimate.
 */
export function SendSingleForm({
  mode,
  country: initialCountry,
  onDone,
  onCancel,
}: SendSingleFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [country, setCountry] = useState(initialCountry ?? "");
  const [recipient, setRecipient] = useState("");
  const [routes, setRoutes] = useState<RouteChoice[] | null>(null);
  const [routeIds, setRouteIds] = useState<string[]>([]);
  const [scheduled, setScheduled] = useState(false);
  const [days, setDays] = useState<number[]>([]);
  const [times, setTimes] = useState<string[]>([]);
  const [timeQuery, setTimeQuery] = useState("");
  const [senderModes, setSenderModes] = useState<SenderMode[]>(["random_string"]);
  const [customSender, setCustomSender] = useState("");
  const [textPresets, setTextPresets] = useState<TextPreset[]>(["hi_no_domain"]);
  const [customText, setCustomText] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [jitter, setJitter] = useState(false);
  const [cascade, setCascade] = useState(false);
  const [more, setMore] = useState(mode === "single");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!country) {
      setRoutes(null);
      return;
    }
    let cancelled = false;
    setRoutes(null);
    routesForCountryAction(country).then((result) => {
      if (cancelled) return;
      setRoutes(result.ok ? result.data : []);
      setRouteIds([]);
    });
    return () => {
      cancelled = true;
    };
  }, [country]);

  const combos = expandTestCombos({ senderModes, textPresets }).length;
  const chosen = (routes ?? []).filter((r) => routeIds.includes(r.id));
  const estimate = testCostEstimate({
    combos,
    routes: chosen.map((r) => ({
      priceMicro: r.priceMicro === null ? null : BigInt(r.priceMicro),
    })),
    cascade,
    label: mode === "single" ? "Single SMS" : "Handset test",
  });

  const toggle = <T,>(list: T[], value: T, set: (next: T[]) => void) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const result = await createSmsTestAction({
        type: mode,
        country,
        recipient: mode === "single" ? recipient.replace(/\D/g, "") : undefined,
        routeIds,
        senderModes,
        customSender,
        textPresets,
        customText,
        hypothesis,
        jitter,
        cascade,
        schedule: scheduled ? { days, times } : null,
        testNetworks: [],
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({
        title: scheduled ? "Test scheduled" : "Test queued",
        description: scheduled
          ? "It runs on the chosen days and times (UTC)."
          : "The worker sends it within a few seconds.",
        variant: "success",
      });
      onDone?.();
      router.refresh();
    });
  };

  const visibleSlots = TIME_SLOTS.filter((s) => s.includes(timeQuery));

  return (
    <form onSubmit={submit} className="space-y-4" data-testid="send-single-form">
      <label className="block text-sm">
        <span className="text-muted">Destination Country</span>
        <select
          className={inputClass}
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          data-testid="single-country"
        >
          <option value="">Search country…</option>
          {countryOptions.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {mode === "single" ? (
        <label className="block text-sm">
          <span className="text-muted">Recipient (To)</span>
          <input
            className={inputClass}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="e.g. 447700900123"
            inputMode="numeric"
            data-testid="single-recipient"
          />
          <span className="text-xs text-muted">International format, digits only</span>
        </label>
      ) : (
        <div
          className="rounded-md border border-amber/30 bg-amber-soft px-3 py-2 text-sm text-amber"
          data-testid="test-net-note"
        >
          No test-network provider is connected yet, so handset tests cannot run. Send Single to
          your own phone instead.
        </div>
      )}
      {mode === "test" ? (
        <button
          type="button"
          className="text-sm text-navy underline-offset-2 hover:underline"
          onClick={() => setMore((m) => !m)}
        >
          {more ? "⌃ Fewer options" : "⌄ More Options"}
        </button>
      ) : null}
      {more ? (
        <>
          <fieldset className="block text-sm">
            <legend className="text-muted">Routes</legend>
            {!country ? (
              <p className="text-xs text-muted">Pick a country first.</p>
            ) : routes === null ? (
              <p className="text-xs text-muted">Loading options…</p>
            ) : routes.length === 0 ? (
              <select className={inputClass} disabled>
                <option>No routes for this country</option>
              </select>
            ) : (
              <div className="mt-1 flex flex-wrap gap-2" data-testid="single-routes">
                {routes.map((r) => (
                  <label
                    key={r.id}
                    className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2 py-1"
                  >
                    <input
                      type="checkbox"
                      checked={routeIds.includes(r.id)}
                      onChange={() => toggle(routeIds, r.id, setRouteIds)}
                    />
                    {r.name}
                    <span className="font-mono text-xs text-muted">
                      {r.priceMicro === null ? "no price" : eur(Number(r.priceMicro))}
                    </span>
                    {!r.platform ? <Badge variant="code">custom</Badge> : null}
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className="flex items-center gap-2">
            <Toggle
              label="Schedule Sending"
              checked={scheduled}
              onCheckedChange={setScheduled}
              testId="single-schedule"
            />
            <Tooltip content="The tests will run automatically on given days and times">
              <Info className="h-3.5 w-3.5 text-muted" aria-label="About scheduling" />
            </Tooltip>
          </div>
          {scheduled ? (
            <div className="grid gap-3 md:grid-cols-2">
              <fieldset className="text-sm">
                <legend className="flex items-center justify-between text-muted">
                  Days of Week
                  <span className="space-x-2 text-xs">
                    <button
                      type="button"
                      className="text-navy"
                      onClick={() => setDays(WEEKDAYS.map((d) => d.value))}
                    >
                      Select All
                    </button>
                    <button type="button" className="text-navy" onClick={() => setDays([])}>
                      Clear
                    </button>
                  </span>
                </legend>
                <div className="mt-1 flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => (
                    <label
                      key={d.value}
                      className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs ${days.includes(d.value) ? "border-navy bg-navy-soft" : "border-rule"}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={days.includes(d.value)}
                        onChange={() => toggle(days, d.value, setDays)}
                      />
                      {d.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="text-sm">
                <legend className="text-muted">Times (select multiple)</legend>
                <input
                  className={`${inputClass} mb-1`}
                  placeholder="Search…"
                  value={timeQuery}
                  onChange={(e) => setTimeQuery(e.target.value)}
                  aria-label="Search times"
                />
                <div className="flex max-h-32 flex-wrap gap-1 overflow-auto rounded-md border border-rule p-1">
                  {visibleSlots.map((s) => (
                    <label
                      key={s}
                      className={`cursor-pointer rounded px-1.5 py-0.5 font-mono text-xs ${times.includes(s) ? "bg-navy text-white" : "hover:bg-neutral-100"}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={times.includes(s)}
                        onChange={() => toggle(times, s, setTimes)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
                <span className="text-xs text-muted">Times are in server time (UTC)</span>
              </fieldset>
            </div>
          ) : null}

          <fieldset className="text-sm">
            <legend className="text-muted">Sender ID</legend>
            <div className="mt-1 space-y-1">
              {SENDER_MODES.map((m, i) => (
                <label key={m.key} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={senderModes.includes(m.key)}
                    onChange={() => toggle(senderModes, m.key, setSenderModes)}
                    data-testid={`sender-${m.key}`}
                  />
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2 w-2 rounded-full ${DOT[i % DOT.length]}`}
                  />
                  {m.label}
                  {m.example ? (
                    <span className="text-xs text-muted">(e.g. {m.example})</span>
                  ) : null}
                </label>
              ))}
              {senderModes.includes("custom") ? (
                <input
                  className={inputClass}
                  placeholder="Custom sender id (3–11 characters)"
                  value={customSender}
                  onChange={(e) => setCustomSender(e.target.value)}
                />
              ) : null}
            </div>
          </fieldset>

          <fieldset className="text-sm">
            <legend className="text-muted">Text Options</legend>
            <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              System presets
            </div>
            <div className="flex flex-wrap gap-1">
              {TEXT_PRESETS.filter((p) => p.group === "system").map((p) => (
                <Tooltip key={p.key} content={p.sample.replaceAll("{{domain}}", "https://…")}>
                  <label
                    className={`cursor-pointer rounded-md border px-2 py-0.5 text-xs ${textPresets.includes(p.key) ? "border-navy bg-navy-soft" : "border-rule"}`}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={textPresets.includes(p.key)}
                      onChange={() => toggle(textPresets, p.key, setTextPresets)}
                    />
                    {p.label}
                  </label>
                </Tooltip>
              ))}
            </div>
            <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
              Custom
            </div>
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={textPresets.includes("custom")}
                onChange={() => toggle(textPresets, "custom", setTextPresets)}
              />{" "}
              Custom Text
            </label>
            {textPresets.includes("custom") ? (
              <textarea
                className={inputClass}
                rows={2}
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="Your text"
              />
            ) : null}
          </fieldset>

          <label className="block text-sm">
            <span className="text-muted">Hypothesis</span>
            <input
              className={inputClass}
              value={hypothesis}
              onChange={(e) => setHypothesis(e.target.value)}
              placeholder="e.g. Testing if .sbs TLD performs better than .click for UK casino traffic"
            />
            <span className="text-xs text-muted">
              Describe what you expect to learn from this test group
            </span>
          </label>

          <div className="flex flex-wrap gap-6">
            <Toggle
              label="Jitter (delay between tests)"
              checked={jitter}
              onCheckedChange={setJitter}
            />
            <div className="flex items-center gap-2">
              <Toggle label="Cascade Mode" checked={cascade} onCheckedChange={setCascade} />
              <Tooltip content="Try the routes in order and stop at the first one that accepts the message">
                <Info className="h-3.5 w-3.5 text-muted" aria-label="About cascade mode" />
              </Tooltip>
            </div>
          </div>

          <div className="rounded-md border border-rule" data-testid="cost-estimate">
            <div className="border-b border-rule px-3 py-1.5 text-xs font-semibold text-ink">
              Cost Estimate
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  <th className="px-3 py-1">Type</th>
                  <th className="px-3 py-1 text-right">Tests</th>
                  <th className="px-3 py-1 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {estimate.rows.map((r) => (
                  <tr key={r.type}>
                    <td className="px-3 py-1">{r.type}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">{r.tests}</td>
                    <td className="px-3 py-1 text-right font-mono tabular-nums">
                      {eur(Number(r.costMicro))}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-rule font-semibold">
                  <td className="px-3 py-1">Total</td>
                  <td
                    className="px-3 py-1 text-right font-mono tabular-nums"
                    data-testid="estimate-tests"
                  >
                    {estimate.tests}
                  </td>
                  <td className="px-3 py-1 text-right font-mono tabular-nums">
                    {estimate.tests > 0 ? eur(Number(estimate.totalMicro)) : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="px-3 py-1.5 text-xs text-muted">
              SMS sending costs apply per route and are charged additionally.
            </p>
          </div>
        </>
      ) : null}
      <ErrorText error={error} />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={pending || mode === "test"} data-testid="single-send">
          <Send className="h-4 w-4" aria-hidden="true" /> Send
        </Button>
      </div>
      <p className="sr-only">{countryName(country || "ES")}</p>
    </form>
  );
}

/** The Send Single SMS / Test SMS dialogs around the form. */
export function SendSingleDialog({
  mode,
  open,
  onClose,
}: {
  mode: "single" | "test";
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent
        className="max-h-[90vh] max-w-xl overflow-y-auto"
        data-testid="send-single-dialog"
      >
        <DialogTitle className="text-lg font-semibold">
          {mode === "single" ? "Send Single SMS" : "Test SMS"}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted">
          {mode === "single"
            ? "Send one message through your routes to a number you control."
            : "Send test messages through your routes and verify what actually lands on a handset."}
        </DialogDescription>
        <p className="mt-2 rounded-md bg-page px-3 py-2 text-xs text-muted">
          {mode === "single"
            ? "To test a single message delivery to your mobile device. The SMS cost will be charged."
            : "The test phones are mobile devices around the world that allow you to test connectivity with real devices. The test cost depends on the test network provider the device is on."}
        </p>
        <div className="mt-4">
          {open ? <SendSingleForm mode={mode} onDone={onClose} onCancel={onClose} /> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
