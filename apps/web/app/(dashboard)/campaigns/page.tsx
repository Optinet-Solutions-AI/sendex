import { RequireOrg } from "../require-org";

export default function CampaignsPage() {
  return (
    <RequireOrg action="campaign.view">
      {() => (
        <section>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="mt-2 text-sm text-neutral-600">Campaign list arrives with card D1-20.</p>
        </section>
      )}
    </RequireOrg>
  );
}
