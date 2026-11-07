import { countryOptions } from "@sendex/core";
import { clickOperators, type Db, listCampaignNames, listListNames } from "@sendex/db";
import type { SegmentChoices } from "../../../components/segments/types";

/** The enum choices of the builder: countries, the organisation's lists, campaigns and networks. */
export async function loadSegmentChoices(db: Db, organisationId: string): Promise<SegmentChoices> {
  const [lists, campaigns, networks] = await Promise.all([
    listListNames(db, organisationId),
    listCampaignNames(db, organisationId),
    clickOperators(db, organisationId),
  ]);
  return {
    countries: countryOptions.map((c) => ({ value: c.code, label: `${c.flag} ${c.name}` })),
    lists: lists.map((l) => ({ value: l.id, label: `${l.name} (${l.country})` })),
    campaigns: campaigns.map((c) => ({ value: c.id, label: c.name })),
    devices: ["mobile", "desktop", "tablet", "bot"].map((d) => ({ value: d, label: d })),
    networks: networks.map((n) => ({ value: n, label: n })),
  };
}
