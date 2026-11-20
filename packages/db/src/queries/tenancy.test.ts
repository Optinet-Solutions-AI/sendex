import { beforeAll, describe, expect, it } from "vitest";
import { memberships, users } from "../schema/core.js";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  getOrganisationPreview,
  getOrganisationPreviewToggle,
  getTenantByClerkIds,
  setOrganisationPreview,
  setOrganisationPreviewToggle,
} from "./tenancy.js";

let t: TestDb;
let orgA: string;
let orgB: string;
let alice: string;

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
  const [row] = await t.db
    .insert(users)
    .values({ clerkUserId: "u_alice", email: "alice@example.com", name: "Alice" })
    .returning({ id: users.id });
  if (!row) throw new Error("user seed failed");
  alice = row.id;
  await t.db
    .insert(memberships)
    .values({ organisationId: orgA, userId: alice, role: "campaign_manager" });
});

describe("getTenantByClerkIds", () => {
  it("returns the user, the organisation and the membership role in one lookup", async () => {
    const tenant = await getTenantByClerkIds(t.db, {
      clerkUserId: "u_alice",
      clerkOrgId: "test_org-a",
    });
    expect(tenant?.user.id).toBe(alice);
    expect(tenant?.organisation.id).toBe(orgA);
    expect(tenant?.organisation.slug).toBe("org-a");
    expect(tenant?.membershipRole).toBe("campaign_manager");
  });

  it("reports a missing membership as null while still returning both rows", async () => {
    const tenant = await getTenantByClerkIds(t.db, {
      clerkUserId: "u_alice",
      clerkOrgId: "test_org-b",
    });
    expect(tenant?.user.id).toBe(alice);
    expect(tenant?.organisation.id).toBe(orgB);
    expect(tenant?.membershipRole).toBeNull();
  });

  it("is null when the user or the organisation has no local row yet", async () => {
    expect(
      await getTenantByClerkIds(t.db, { clerkUserId: "u_nobody", clerkOrgId: "test_org-a" }),
    ).toBeNull();
    expect(
      await getTenantByClerkIds(t.db, { clerkUserId: "u_alice", clerkOrgId: "org_unknown" }),
    ).toBeNull();
  });
});

describe("preview features switch (D5-09)", () => {
  it("is off for every organisation until it is switched on, one organisation at a time", async () => {
    const qa = await seedOrganisation(t.db, "preview-qa");
    const other = await seedOrganisation(t.db, "preview-other");
    expect(await getOrganisationPreview(t.db, qa)).toBe(false);

    expect(await setOrganisationPreview(t.db, qa, true)).toBe(true);
    expect(await getOrganisationPreview(t.db, qa)).toBe(true);
    expect(await getOrganisationPreview(t.db, other)).toBe(false);

    expect(await setOrganisationPreview(t.db, qa, false)).toBe(true);
    expect(await getOrganisationPreview(t.db, qa)).toBe(false);
  });

  it("reports an organisation that does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await setOrganisationPreview(t.db, missing, true)).toBe(false);
    expect(await getOrganisationPreview(t.db, missing)).toBe(false);
  });
});

describe("Existing / New toggle (D5-11)", () => {
  it("is off until switched on, one organisation at a time, apart from the preview switch", async () => {
    const qa = await seedOrganisation(t.db, "toggle-qa");
    const other = await seedOrganisation(t.db, "toggle-other");
    expect(await getOrganisationPreviewToggle(t.db, qa)).toBe(false);

    expect(await setOrganisationPreviewToggle(t.db, qa, true)).toBe(true);
    expect(await getOrganisationPreviewToggle(t.db, qa)).toBe(true);
    expect(await getOrganisationPreviewToggle(t.db, other)).toBe(false);
    // The toggle only offers the choice: the preview itself stays off.
    expect(await getOrganisationPreview(t.db, qa)).toBe(false);

    expect(await setOrganisationPreviewToggle(t.db, qa, false)).toBe(true);
    expect(await getOrganisationPreviewToggle(t.db, qa)).toBe(false);
  });

  it("reports an organisation that does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(await setOrganisationPreviewToggle(t.db, missing, true)).toBe(false);
    expect(await getOrganisationPreviewToggle(t.db, missing)).toBe(false);
  });
});
