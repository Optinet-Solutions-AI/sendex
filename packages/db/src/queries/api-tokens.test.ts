import { API_TOKEN_PREFIX, hashApiToken } from "@sendex/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import { createApiToken, findApiTokenByHash, listApiTokens, revokeApiToken } from "./api-tokens.js";

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

describe("createApiToken", () => {
  it("returns the plaintext once and stores only its hash and display prefix", async () => {
    const created = await createApiToken(t.db, orgA, {
      name: "CI",
      scopes: ["read", "send"],
      createdBy: null,
    });
    expect(created.token.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(created.row.prefix).toBe(created.token.slice(0, 12));
    expect(created.row.tokenHash).toBe(await hashApiToken(created.token));
    expect(created.row.scopes).toEqual(["read", "send"]);
    expect(created.row.organisationId).toBe(orgA);
    expect(created.row.revokedAt).toBeNull();
    expect(created.row.lastUsedAt).toBeNull();
    expect(JSON.stringify(created.row)).not.toContain(created.token);
  });
});

describe("findApiTokenByHash", () => {
  it("resolves a live token to its organisation and scopes and stamps last_used_at", async () => {
    const created = await createApiToken(t.db, orgA, {
      name: "Lookup",
      scopes: ["read"],
      createdBy: null,
    });
    const found = await findApiTokenByHash(t.db, await hashApiToken(created.token));
    expect(found).toMatchObject({
      id: created.row.id,
      organisationId: orgA,
      name: "Lookup",
      scopes: ["read"],
    });
    const rows = await listApiTokens(t.db, orgA);
    expect(rows.find((r) => r.id === created.row.id)?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("returns null for an unknown hash", async () => {
    expect(await findApiTokenByHash(t.db, await hashApiToken("sdx_nope"))).toBeNull();
  });
});

describe("listApiTokens", () => {
  it("lists the organisation's tokens newest first, without hashes, and never another's", async () => {
    const org = await seedOrganisation(t.db, "org-list");
    const first = await createApiToken(t.db, org, { name: "first", scopes: ["read"] });
    const second = await createApiToken(t.db, org, { name: "second", scopes: ["write"] });
    const rows = await listApiTokens(t.db, org);
    expect(rows.map((r) => r.name)).toEqual(["second", "first"]);
    expect(rows.map((r) => r.id)).toEqual([second.row.id, first.row.id]);
    for (const row of rows) expect(Object.keys(row)).not.toContain("tokenHash");
    expect(await listApiTokens(t.db, orgB)).toEqual([]);
  });
});

describe("revokeApiToken", () => {
  it("revokes once; the token stops resolving and the row stays listed as revoked", async () => {
    const created = await createApiToken(t.db, orgA, { name: "Revoke me", scopes: ["read"] });
    const hash = await hashApiToken(created.token);
    expect(await findApiTokenByHash(t.db, hash)).not.toBeNull();

    const revoked = await revokeApiToken(t.db, orgA, created.row.id);
    expect(revoked?.revokedAt).toBeInstanceOf(Date);
    expect(await findApiTokenByHash(t.db, hash)).toBeNull();
    const listed = (await listApiTokens(t.db, orgA)).find((r) => r.id === created.row.id);
    expect(listed?.revokedAt).toBeInstanceOf(Date);

    // A second revoke is a no-op that keeps the original timestamp.
    const again = await revokeApiToken(t.db, orgA, created.row.id);
    expect(again?.revokedAt?.getTime()).toBe(revoked?.revokedAt?.getTime());
  });

  it("cannot revoke another organisation's token", async () => {
    const created = await createApiToken(t.db, orgA, { name: "Mine", scopes: ["read"] });
    expect(await revokeApiToken(t.db, orgB, created.row.id)).toBeNull();
    expect(await findApiTokenByHash(t.db, await hashApiToken(created.token))).not.toBeNull();
  });
});
