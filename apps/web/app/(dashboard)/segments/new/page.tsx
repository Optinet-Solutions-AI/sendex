import { can } from "@sendex/core";
import { db } from "@sendex/db";
import { PageHeader } from "@sendex/ui";
import { SegmentBuilder } from "../../../../components/segments/segment-builder";
import { aiRulesEnabled } from "../../../../lib/ai-rules";
import { AuthError, requireAction } from "../../../../lib/auth";
import { AuthErrorView } from "../../require-org";
import { loadSegmentChoices } from "../choices";

export const dynamic = "force-dynamic";

/** Segments › NEW SEGMENT: the builder with an empty rule tree. */
export default async function NewSegmentPage() {
  let ctx: Awaited<ReturnType<typeof requireAction>>;
  try {
    ctx = await requireAction("list.upload");
  } catch (error) {
    if (error instanceof AuthError) return <AuthErrorView error={error} />;
    throw error;
  }
  const choices = await loadSegmentChoices(db(), ctx.organisationId);
  return (
    <section className="space-y-2">
      <PageHeader
        breadcrumb={[{ label: "Segments", href: "/segments" }, { label: "New segment" }]}
        title={<span className="sr-only">New segment</span>}
      />
      <SegmentBuilder
        segment={null}
        choices={choices}
        canEdit={can(ctx.role, "list.upload")}
        aiEnabled={aiRulesEnabled()}
      />
    </section>
  );
}
