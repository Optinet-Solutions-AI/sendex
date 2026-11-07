import { can } from "@sendex/core";
import { db, getSegment } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { notFound } from "next/navigation";
import { SegmentBuilder } from "../../../../components/segments/segment-builder";
import { aiRulesEnabled } from "../../../../lib/ai-rules";
import { AuthError, requireAction } from "../../../../lib/auth";
import { AuthErrorView } from "../../require-org";
import { loadSegmentChoices } from "../choices";
import { toSegmentView } from "../page";

export const dynamic = "force-dynamic";

/** Segments › NAME: the saved rules, the sample and Segment Analytics, editable in place. */
export default async function SegmentPage({ params }: { params: Promise<{ id: string }> }) {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.view");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [row, choices] = await Promise.all([
    getSegment(db(), ctx.organisationId, id),
    loadSegmentChoices(db(), ctx.organisationId),
  ]);
  if (!row) notFound();
  const segment = toSegmentView(row);
  return (
    <section className="space-y-2">
      <PageHeader
        breadcrumb={[{ label: "Segments", href: "/segments" }, { label: segment.name }]}
        title={<span className="sr-only">{segment.name}</span>}
      />
      <SegmentBuilder
        segment={segment}
        choices={choices}
        canEdit={can(ctx.role, "list.upload")}
        aiEnabled={aiRulesEnabled()}
      />
    </section>
  );
}
