import { getTableColumns, getTableName, isTable, type Table } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema/index.js";

/** Platform-level tables that are not owned by a tenant. */
// carrier_balances: our account at each carrier, shared by the organisations on it (D5-17).
const TENANT_EXEMPT = new Set([
  "organisations",
  "users",
  "route_prices",
  "lookup_prices",
  "carrier_balances",
]);

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
