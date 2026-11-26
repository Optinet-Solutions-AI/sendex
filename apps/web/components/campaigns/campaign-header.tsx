"use client";

import { countryName, FORMULAS, flagEmoji } from "@sendex/core";
import {
  Button,
  Card,
  ConfirmDialog,
  Explained,
  IconButton,
  KpiStrip,
  PageHeader,
  useToast,
} from "@sendex/ui";
import { Check, Copy, MoreVertical, Pencil, Send, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteCampaignAction,
  duplicateCampaignAction,
  renameCampaignAction,
} from "../../app/(dashboard)/campaigns/actions";
import { CampaignStatusBadge } from "./campaigns-table";
import {
  explainCostOfLaps,
  explainCostPer,
  explainProgress,
  explainRate,
  LOCAL_FORMULAS,
} from "./explain";
import { Figure } from "./figure";
import {
  campaignTotals,
  formatDateTime,
  formatMicro,
  formatPer,
  formatPercent,
  shortId,
} from "./format";
import type { CampaignView, ResultTotalsView } from "./types";

/**
 * The spec's campaign header: breadcrumb SMS › Campaigns › #id, the name with its status
 * badge, flag, country, timezone and created date underneath, New Send and a ⋮ menu on the
 * right, the KPI strip (sent · clicks · CTR | leads · sales | cost · CPL · CPS, plus
 * delivered, failed and delivery rate) and the Sending progress card once something was sent.
 */
export function CampaignHeader({
  campaign,
  totals: results,
  canEdit,
}: {
  campaign: CampaignView;
  totals?: ResultTotalsView;
  canEdit: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, start] = useTransition();
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState(campaign.name);
  const totals = results ?? campaignTotals(campaign.laps);
  const contacts =
    campaign.lists.reduce((sum, l) => sum + l.available, 0) +
    campaign.segments.reduce((sum, seg) => sum + seg.available, 0);
  const planned = campaign.laps.reduce((sum, l) => sum + l.testSize, 0);
  const target = planned > 0 ? planned : contacts;
  const progress = target > 0 ? Math.min(100, Math.round((totals.sent / target) * 100)) : 0;
  const hasSent = campaign.laps.length > 0;

  function duplicate() {
    setMenuOpen(false);
    start(async () => {
      const result = await duplicateCampaignAction({ campaignId: campaign.id });
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      toast({ title: "Campaign duplicated", variant: "success" });
      router.push(`/campaigns/${result.data.id}`);
    });
  }

  function saveName() {
    const name = nameDraft.trim();
    if (name === "" || name === campaign.name) {
      setEditingName(false);
      setNameDraft(campaign.name);
      return;
    }
    start(async () => {
      const result = await renameCampaignAction({ campaignId: campaign.id, name });
      if (!result.ok) {
        toast({ title: result.error, variant: "error" });
        return;
      }
      setEditingName(false);
      toast({ title: "Campaign renamed", variant: "success" });
      router.refresh();
    });
  }

  function cancelName() {
    setEditingName(false);
    setNameDraft(campaign.name);
  }

  async function remove() {
    const result = await deleteCampaignAction({ campaignId: campaign.id });
    if (!result.ok) throw new Error(result.error);
    toast({ title: "Campaign deleted", variant: "success" });
    router.push("/campaigns");
  }

  return (
    <header className="space-y-4">
      <PageHeader
        breadcrumb={[
          { label: "SMS" },
          { label: "Campaigns", href: "/campaigns" },
          { label: `#${shortId(campaign.id)}` },
        ]}
        title={
          editingName ? (
            // A span, not a form: the title sits inside the page's h1.
            <span className="flex items-center gap-2">
              <input
                aria-label="Campaign name"
                // biome-ignore lint/a11y/noAutofocus: the field opens on purpose, from the pencil.
                autoFocus
                maxLength={120}
                value={nameDraft}
                disabled={pending}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveName();
                  if (event.key === "Escape") cancelName();
                }}
                className="min-w-0 rounded-md border border-rule bg-surface px-2 py-1 text-2xl font-semibold text-ink"
              />
              <IconButton
                type="button"
                label="Save name"
                icon={<Check />}
                disabled={pending}
                onClick={saveName}
              />
              <IconButton type="button" label="Cancel rename" icon={<X />} onClick={cancelName} />
            </span>
          ) : (
            <span className="inline-flex items-center gap-2">
              <span data-testid="campaign-name">{campaign.name}</span>
              {canEdit ? (
                <IconButton
                  label="Rename campaign"
                  icon={<Pencil />}
                  onClick={() => {
                    setNameDraft(campaign.name);
                    setEditingName(true);
                  }}
                />
              ) : null}
            </span>
          )
        }
        titleAside={<CampaignStatusBadge status={campaign.status} />}
        meta={
          <>
            {flagEmoji(campaign.country)} {countryName(campaign.country)} · {campaign.timezone} ·
            Created {formatDateTime(campaign.createdAt, campaign.timezone)}
          </>
        }
        actions={
          canEdit ? (
            <>
              {hasSent ? (
                <Button variant="outline" asChild>
                  <a href="#send-this-campaign">
                    <Send className="h-4 w-4" aria-hidden="true" /> New Send
                  </a>
                </Button>
              ) : null}
              <div className="relative">
                <IconButton
                  label="Campaign actions"
                  icon={<MoreVertical />}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  onClick={() => setMenuOpen((o) => !o)}
                  noTooltip
                />
                {menuOpen ? (
                  <>
                    <button
                      type="button"
                      aria-label="Close menu"
                      className="fixed inset-0 z-10 cursor-default"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div
                      role="menu"
                      className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-rule bg-surface py-1 text-sm shadow-md"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100"
                        onClick={duplicate}
                        disabled={pending}
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" /> Duplicate
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-signal hover:bg-red-50 disabled:text-muted"
                        onClick={() => {
                          setMenuOpen(false);
                          setConfirmDelete(true);
                        }}
                        disabled={pending || campaign.status !== "draft"}
                        title={
                          campaign.status === "draft" ? undefined : "Only drafts can be deleted"
                        }
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete campaign
                      </button>
                    </div>
                  </>
                ) : null}
              </div>
            </>
          ) : null
        }
      />
      <KpiStrip
        label="Campaign totals"
        items={[
          { label: "Sent", value: totals.sent.toLocaleString("en-GB"), testId: "total-sent" },
          {
            label: "Delivered",
            value: totals.delivered.toLocaleString("en-GB"),
            testId: "total-delivered",
          },
          { label: "Failed", value: totals.failed.toLocaleString("en-GB"), testId: "total-failed" },
          {
            label: <Explained formula={FORMULAS.deliveryRate}>Delivery</Explained>,
            value: (
              <Figure
                explanation={explainRate(
                  "deliveryRate",
                  totals.delivered,
                  totals.sent,
                  totals.deliveryRate,
                )}
              >
                {formatPercent(totals.deliveryRate)}
              </Figure>
            ),
            testId: "total-delivery-rate",
          },
          {
            label: <Explained formula={FORMULAS.clicks}>Clicks</Explained>,
            value: totals.clicks.toLocaleString("en-GB"),
            testId: "total-clicks",
          },
          {
            label: <Explained formula={FORMULAS.ctr}>CTR</Explained>,
            value: (
              <Figure explanation={explainRate("ctr", totals.clicks, totals.sent, totals.ctr)}>
                {formatPercent(totals.ctr)}
              </Figure>
            ),
            testId: "total-ctr",
          },
          { label: "Leads", value: totals.leads.toLocaleString("en-GB"), testId: "total-leads" },
          {
            label: <Explained formula={FORMULAS.sales}>Sales</Explained>,
            value: totals.sales.toLocaleString("en-GB"),
            testId: "total-sales",
          },
          {
            label: <Explained formula={LOCAL_FORMULAS.campaignCost}>Cost</Explained>,
            value: (
              <Figure
                explanation={explainCostOfLaps(
                  campaign.laps.map((l) => l.costMicro),
                  totals.costMicro,
                )}
              >
                {formatMicro(totals.costMicro)}
              </Figure>
            ),
            testId: "total-cost",
          },
          {
            label: <Explained formula={FORMULAS.cpc}>CPC</Explained>,
            value: (
              <Figure
                explanation={explainCostPer(
                  "cpc",
                  totals.costMicro,
                  totals.clicks,
                  totals.cpcMicro,
                )}
              >
                {formatPer(totals.cpcMicro)}
              </Figure>
            ),
            testId: "total-cpc",
          },
          {
            label: <Explained formula={FORMULAS.cpl}>CPL</Explained>,
            value: (
              <Figure
                explanation={explainCostPer("cpl", totals.costMicro, totals.leads, totals.cplMicro)}
              >
                {formatPer(totals.cplMicro)}
              </Figure>
            ),
            testId: "total-cpl",
          },
          {
            label: <Explained formula={FORMULAS.cps}>CPS</Explained>,
            value: (
              <Figure
                explanation={explainCostPer("cps", totals.costMicro, totals.sales, totals.cpsMicro)}
              >
                {formatPer(totals.cpsMicro)}
              </Figure>
            ),
            testId: "total-cps",
          },
        ]}
      />
      <Card className="px-4 py-3" data-testid="campaign-totals">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
            Sending progress
          </span>
          <span className="font-mono text-sm" data-testid="sending-progress">
            {totals.sent.toLocaleString("en-GB")} / {target.toLocaleString("en-GB")} contacts
            <Figure
              className="ml-2 text-muted"
              explanation={explainProgress({ sent: totals.sent, planned, contacts, progress })}
            >
              {progress}%
            </Figure>
          </span>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded bg-neutral-200"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Sending progress"
        >
          <div
            className="h-full bg-cyan-500 transition-[width]"
            style={{ width: `${progress}%` }}
          />
        </div>
      </Card>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete Campaign"
        description={`Delete "${campaign.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={remove}
      />
    </header>
  );
}
