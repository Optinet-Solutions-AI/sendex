"use client";

import { countRules, emptySegmentGroup, type SegmentGroup, validateSegment } from "@sendex/core";
import { Button, Card, Checkbox, Textarea, useToast } from "@sendex/ui";
import { ArrowLeft, Download, Info, Save, ShieldBan, Sparkles } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  createSegmentAction,
  generateRulesAction,
  previewSegmentAction,
  updateSegmentAction,
} from "../../app/(dashboard)/segments/actions";
import { ErrorText } from "../campaigns/ui";
import { PreviewCard } from "./preview-card";
import { numberRules, RuleGroup } from "./rule-group";
import type { SegmentChoices, SegmentPreviewView, SegmentView } from "./types";

/**
 * The segment builder and editor of the spec: a back arrow and an inline name, Cancel and
 * Save (disabled until valid); left, the AI Rule Generator, the Rules card and the Global
 * negative segment; right, the live Preview. Editing shows the saved rules, a sample and the
 * analytics breakdowns, plus Export CSV.
 */
export function SegmentBuilder({
  segment,
  choices,
  canEdit,
  aiEnabled = false,
}: {
  /** Null for a new segment. */
  segment: SegmentView | null;
  choices: SegmentChoices;
  canEdit: boolean;
  /** Shows the AI Rule Generator card (`ENABLE_AI_RULES=1`); hidden otherwise. */
  aiEnabled?: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const id = useId();
  const [name, setName] = useState(segment?.name ?? "");
  const [definition, setDefinition] = useState<SegmentGroup>(
    segment?.definition ?? emptySegmentGroup(),
  );
  const [isTemplate, setIsTemplate] = useState(segment?.isTemplate ?? false);
  const [globalExclude, setGlobalExclude] = useState(segment?.globalExclude ?? false);
  const [prompt, setPrompt] = useState("");
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [preview, setPreview] = useState<SegmentPreviewView | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [generating, startGenerate] = useTransition();
  const timer = useRef<number | null>(null);

  const problems = validateSegment(definition);
  const invalidIds = new Set(problems.map((p) => p.ruleId));
  const rules = countRules(definition);
  const numbers = numberRules(definition);
  const valid = name.trim() !== "" && rules > 0 && problems.length === 0;

  // The preview follows the rules live, half a second after the last change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the serialised tree is the signal.
  useEffect(() => {
    if (rules === 0 || problems.length > 0) {
      setPreview(null);
      setPreviewing(false);
      return;
    }
    setPreviewing(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      const result = await previewSegmentAction(definition);
      if (result.ok) {
        setPreview(result.data);
        setPreviewError(null);
      } else {
        setPreviewError(result.error);
      }
      setPreviewing(false);
    }, 500);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [JSON.stringify(definition), rules, problems.length]);

  function save() {
    setError(null);
    startSave(async () => {
      const payload = { name: name.trim(), definition, isTemplate, globalExclude };
      const result = segment
        ? await updateSegmentAction({ ...payload, segmentId: segment.id })
        : await createSegmentAction(payload);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      toast({ title: segment ? "Segment saved" : "Segment created", variant: "success" });
      if (segment) router.refresh();
      else router.push(`/segments/${result.data.id}`);
    });
  }

  function generate() {
    setAiNote(null);
    setError(null);
    startGenerate(async () => {
      const result = await generateRulesAction({ prompt, current: definition });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setDefinition(result.data.definition);
      setAiNote(result.data.note);
      setPrompt("");
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/segments" aria-label="Back to segments" className="text-muted hover:text-ink">
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Segment name…"
          aria-label="Segment name"
          maxLength={120}
          disabled={!canEdit}
          className="h-10 min-w-[16rem] flex-1 rounded-md border border-transparent bg-transparent px-2 text-xl font-semibold text-ink placeholder:font-normal placeholder:text-muted hover:border-neutral-300 focus:border-navy focus:outline-none"
          data-testid="segment-name"
        />
        <div className="ml-auto flex items-center gap-2">
          {segment ? (
            <Button variant="outline" asChild>
              <a href={`/segments/${segment.id}/export`}>
                <Download className="h-4 w-4" aria-hidden="true" /> Export CSV
              </a>
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link href="/segments">Cancel</Link>
          </Button>
          {canEdit ? (
            <Button onClick={save} disabled={!valid || saving} data-testid="segment-save">
              <Save className="h-4 w-4" aria-hidden="true" /> {saving ? "Saving…" : "Save"}
            </Button>
          ) : null}
        </div>
      </div>
      <ErrorText error={error} />

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          {aiEnabled ? (
            <Card>
              <div className="flex items-center gap-2 border-b border-rule px-4 py-3">
                <Sparkles className="h-4 w-4 text-navy" aria-hidden="true" />
                <h3 className="text-sm font-semibold text-ink">AI Rule Generator</h3>
              </div>
              <div className="space-y-2 p-4">
                <label htmlFor={`${id}-prompt`} className="sr-only">
                  Describe your audience
                </label>
                <Textarea
                  id={`${id}-prompt`}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={
                    rules === 0
                      ? 'Describe your audience: e.g. "UK clickers from the last 30 days"'
                      : 'Add or edit rules: e.g. "also exclude numbers with no clicks in 60 days"'
                  }
                  className="min-h-20"
                  disabled={!canEdit}
                  data-testid="ai-prompt"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {rules === 0
                      ? "Turns plain English into rules."
                      : "Will add new or update existing rules"}
                  </span>
                  <Button
                    size="sm"
                    onClick={generate}
                    disabled={!canEdit || generating || prompt.trim() === ""}
                    data-testid="ai-generate"
                  >
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />{" "}
                    {generating ? "Generating…" : "Generate"}
                  </Button>
                </div>
                {aiNote ? <p className="text-xs text-good">{aiNote}</p> : null}
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="flex items-center justify-between border-b border-rule px-4 py-3">
              <h3 className="text-sm font-semibold text-ink">Rules</h3>
              <span className="text-xs text-muted">
                {rules} rule{rules === 1 ? "" : "s"}
              </span>
            </div>
            <div className="space-y-3 p-4">
              {problems.length > 0 ? (
                <div
                  className="space-y-1 rounded-md border border-amber/40 bg-amber-soft px-3 py-2 text-xs text-amber"
                  role="alert"
                  data-testid="segment-problems"
                >
                  {problems.map((p) => (
                    <p key={p.ruleId + p.message} className="flex items-start gap-1.5">
                      <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" /> {p.message}
                    </p>
                  ))}
                </div>
              ) : null}
              {rules === 0 ? (
                <div className="py-6 text-center">
                  <p className="text-sm text-muted">
                    No rules yet. Add your first rule to define the segment.
                  </p>
                  <RuleGroup
                    group={definition}
                    numbers={numbers}
                    invalidIds={invalidIds}
                    choices={choices}
                    onChange={setDefinition}
                    onRuleRemoved={() => toast({ title: "Rule removed" })}
                  />
                </div>
              ) : (
                <RuleGroup
                  group={definition}
                  numbers={numbers}
                  invalidIds={invalidIds}
                  choices={choices}
                  onChange={setDefinition}
                  onRuleRemoved={() => toast({ title: "Rule removed" })}
                />
              )}
            </div>
          </Card>

          <Card className="p-4">
            <label htmlFor={`${id}-exclude`} className="flex items-start gap-3 text-sm">
              <Checkbox
                id={`${id}-exclude`}
                checked={globalExclude}
                onCheckedChange={(v) => setGlobalExclude(v === true)}
                className="mt-0.5"
                disabled={!canEdit}
                aria-label="Global negative segment"
                data-testid="global-exclude"
              />
              <span>
                <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                  <ShieldBan className="h-4 w-4 text-muted" aria-hidden="true" /> Global negative
                  segment
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  Numbers matching this segment will be excluded globally from all campaigns. Use
                  this to permanently suppress contacts across your entire account.
                </span>
              </span>
            </label>
            <label htmlFor={`${id}-template`} className="mt-3 flex items-start gap-3 text-sm">
              <Checkbox
                id={`${id}-template`}
                checked={isTemplate}
                onCheckedChange={(v) => setIsTemplate(v === true)}
                className="mt-0.5"
                disabled={!canEdit}
                aria-label="Save as template"
              />
              <span>
                <span className="font-medium text-ink">Save as template</span>
                <span className="mt-0.5 block text-xs text-muted">
                  Templates are starting points under the Templates tab; they are not audiences.
                </span>
              </span>
            </label>
          </Card>
        </div>

        <div className="space-y-4">
          <PreviewCard
            preview={preview}
            loading={previewing}
            hasRules={rules > 0 && problems.length === 0}
            error={previewError}
            title={segment ? "Segment Analytics" : "Preview"}
          />
          {segment?.summary ? (
            <Card className="p-4 text-sm">
              <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                Saved rules
              </div>
              <p className="mt-1 text-ink">{segment.summary}</p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
