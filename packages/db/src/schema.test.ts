import { getTableColumns, getTableName, isTable, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Platform-level tables that are not owned by a tenant. */
const TENANT_EXEMPT = new Set(["organisations", "users", "route_prices", "lookup_prices"]);

const tables: Table[] = [];
for (const value of Object.values<unknown>(schema)) {
  if (isTable(value)) tables.push(value);
}

describe("schema conventions", () => {
  it("finds the tables", () => {
    expect(tables.length).toBeGreaterThan(4);
  });

  it("every tenant table carries organisation_id", () => {
    for (const table of tables) {
      const name = getTableName(table);
      if (TENANT_EXEMPT.has(name)) continue;
      const cols = getTableColumns(table);
      expect(Object.keys(cols), `${name} must have organisationId`).toContain("organisationId");
    }
  });
});
