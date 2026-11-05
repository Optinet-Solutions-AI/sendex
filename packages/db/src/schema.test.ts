import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

const TENANT_EXEMPT = new Set(["organisations", "users"]);

describe("schema conventions", () => {
  it("every tenant table carries organisation_id", () => {
    for (const value of Object.values(schema)) {
      if (typeof value !== "object" || value === null || !("$inferSelect" in (value as object)))
        continue;
      const table = value as Parameters<typeof getTableName>[0];
      const name = getTableName(table);
      if (TENANT_EXEMPT.has(name)) continue;
      const cols = getTableColumns(table);
      expect(Object.keys(cols), `${name} must have organisationId`).toContain("organisationId");
    }
  });
});
