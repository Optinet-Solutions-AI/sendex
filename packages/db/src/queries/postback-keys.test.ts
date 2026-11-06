import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  findOrganisationByKey,
  getOrCreatePostbackKey,
  rotatePostbackKey,
} from "./postback-keys.js";

let t: TestDb;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  t = await createTestDb();
  orgA = await seedOrganisation(t.db, "org-a");
  orgB = await seedOrganisation(t.db, "org-b");
});

afterAll(async () => {
  await t.close();
});

describe("getOrCreatePostbackKey", () => {
  it("generates a secret on first read and returns the same one afterwards", async () => {
    const first = await getOrCreatePostbackKey(t.db, orgA);
    expect(first.organisationId).toBe(orgA);
    expect(first.secret).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(first.rotatedAt).toBeNull();
    const again = await getOrCreatePostbackKey(t.db, orgA);
    expect(again.secret).toBe(first.secret);
  });

  it("gives every organisation its own secret", async () => {
    const a = await getOrCreatePostbackKey(t.db, orgA);
    const b = await getOrCreatePostbackKey(t.db, orgB);
    expect(b.secret).not.toBe(a.secret);
  });

  it("survives two concurrent first reads", async () => {
    const org = await seedOrganisation(t.db, "org-race");
    const [x, y] = await Promise.all([
      getOrCreatePostbackKey(t.db, org),
      getOrCreatePostbackKey(t.db, org),
    ]);
    expect(x.secret).toBe(y.secret);
  });
});

describe("rotatePostbackKey", () => {
  it("replaces the secret and stamps rotated_at", async () => {
    const before = await getOrCreatePostbackKey(t.db, orgA);
    const rotated = await rotatePostbackKey(t.db, orgA);
    expect(rotated.secret).not.toBe(before.secret);
    expect(rotated.rotatedAt).toBeInstanceOf(Date);
    const after = await getOrCreatePostbackKey(t.db, orgA);
    expect(after.secret).toBe(rotated.secret);
  });

  it("creates the row when rotating an organisation that never read its key", async () => {
    const org = await seedOrganisation(t.db, "org-fresh");
    const rotated = await rotatePostbackKey(t.db, org);
    expect(rotated.organisationId).toBe(org);
    expect(rotated.secret.length).toBeGreaterThan(30);
  });
});

describe("findOrganisationByKey", () => {
  it("resolves by id and by slug, null otherwise", async () => {
    await expect(findOrganisationByKey(t.db, orgA)).resolves.toEqual({ id: orgA, slug: "org-a" });
    await expect(findOrganisationByKey(t.db, "org-b")).resolves.toEqual({
      id: orgB,
      slug: "org-b",
    });
    await expect(findOrganisationByKey(t.db, "nope")).resolves.toBeNull();
    await expect(
      findOrganisationByKey(t.db, "00000000-0000-4000-8000-000000000000"),
    ).resolves.toBeNull();
  });
});
