/**
 * Generates docs/engineering/erd.md (a Mermaid erDiagram) from the Drizzle schema.
 *
 *   pnpm --filter @sendex/db erd          regenerate the page
 *   pnpm --filter @sendex/db erd:check    exit 1 when the committed page is stale
 *
 * Output is fully deterministic (tables, columns and relationships sorted, no
 * timestamp) so regenerating without a schema change is byte-identical.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getTableColumns, getTableName, is, isTable, type SQL } from "drizzle-orm";
import { getTableConfig, type IndexedColumn, type PgColumn, PgTable } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index.js";

const outputPath = fileURLToPath(new URL("../../../docs/engineering/erd.md", import.meta.url));

type KeyMarker = "PK" | "FK" | "UK";

interface Attribute {
  name: string;
  sqlType: string;
  keys: KeyMarker[];
  comment: string | undefined;
}

interface Entity {
  name: string;
  attributes: Attribute[];
}

interface Relationship {
  parent: string;
  child: string;
  label: string;
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name, "en");
}

/** Mermaid attribute types are single words: `timestamp with time zone` -> `timestamp_with_time_zone`. */
function mermaidType(sqlType: string): string {
  return sqlType
    .replace(/[^A-Za-z0-9_\-[\]()]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

function isNamedIndexedColumn(
  value: Partial<IndexedColumn | SQL>,
): value is IndexedColumn & { name: string } {
  return "name" in value && typeof value.name === "string";
}

function collectTables(): PgTable[] {
  const tables: PgTable[] = [];
  for (const value of Object.values(schema)) {
    if (isTable(value) && is(value, PgTable)) {
      tables.push(value);
    }
  }
  return tables.sort((a, b) => getTableName(a).localeCompare(getTableName(b), "en"));
}

function describeTable(table: PgTable): { entity: Entity; relationships: Relationship[] } {
  const tableName = getTableName(table);
  const config = getTableConfig(table);

  const primary = new Set<string>();
  const foreign = new Set<string>();
  /** column name -> names of the other columns it is unique together with */
  const unique = new Map<string, string[]>();

  const markUnique = (columns: string[]): void => {
    for (const column of columns) {
      const others = columns.filter((c) => c !== column);
      unique.set(column, [...(unique.get(column) ?? []), ...others]);
    }
  };

  const columns: PgColumn[] = Object.values(getTableColumns(table));
  for (const column of columns) {
    if (column.primary) primary.add(column.name);
    if (column.isUnique) markUnique([column.name]);
  }
  for (const pk of config.primaryKeys) {
    for (const column of pk.columns) primary.add(column.name);
  }
  for (const constraint of config.uniqueConstraints) {
    markUnique(constraint.columns.map((c) => c.name));
  }
  for (const index of config.indexes) {
    if (!index.config.unique) continue;
    const names = index.config.columns.filter(isNamedIndexedColumn).map((c) => c.name);
    if (names.length === index.config.columns.length) markUnique(names);
  }

  const relationships: Relationship[] = [];
  for (const fk of config.foreignKeys) {
    const reference = fk.reference();
    const columns = reference.columns.map((c) => c.name);
    for (const column of columns) foreign.add(column);
    relationships.push({
      parent: getTableName(reference.foreignTable),
      child: tableName,
      label: columns.join(", "),
    });
  }

  const attributes: Attribute[] = columns
    .map((column) => {
      const keys: KeyMarker[] = [];
      if (primary.has(column.name)) keys.push("PK");
      if (foreign.has(column.name)) keys.push("FK");
      if (unique.has(column.name)) keys.push("UK");
      const uniqueWith = [...new Set(unique.get(column.name) ?? [])].sort();
      return {
        name: column.name,
        sqlType: column.getSQLType(),
        keys,
        comment: uniqueWith.length > 0 ? `unique with ${uniqueWith.join(", ")}` : undefined,
      };
    })
    .sort(byName);

  return { entity: { name: tableName, attributes }, relationships };
}

function renderMermaid(entities: Entity[], relationships: Relationship[]): string {
  const lines: string[] = ["erDiagram"];
  for (const entity of entities) {
    lines.push(`  ${entity.name} {`);
    for (const attribute of entity.attributes) {
      const parts = [mermaidType(attribute.sqlType), attribute.name];
      if (attribute.keys.length > 0) parts.push(attribute.keys.join(", "));
      if (attribute.comment !== undefined) parts.push(`"${attribute.comment}"`);
      lines.push(`    ${parts.join(" ")}`);
    }
    lines.push("  }");
  }
  if (relationships.length > 0) lines.push("");
  for (const rel of relationships) {
    lines.push(`  ${rel.parent} ||--o{ ${rel.child} : "${rel.label}"`);
  }
  return lines.join("\n");
}

function renderPage(entities: Entity[], relationships: Relationship[]): string {
  return [
    "# Database ER diagram",
    "",
    "Every table in `packages/db/src/schema` with its columns and SQL types. `PK`, `FK` and `UK` mark " +
      "primary keys, foreign keys and unique columns (a `UK` on a column of a composite unique index " +
      "says which columns it is unique with). Each line between two entities is a foreign key, " +
      "labelled with the referencing column, drawn from the parent to the child. Tenant tables carry " +
      "`organisation_id`; the ledger has no balance column (see AGENTS.md).",
    "",
    "```mermaid",
    renderMermaid(entities, relationships),
    "```",
    "",
    `Generated from the Drizzle schema by \`pnpm --filter @sendex/db erd\` (${entities.length} tables, ` +
      `${relationships.length} relationships). Do not edit by hand: regenerate after every schema change. ` +
      "CI runs `pnpm --filter @sendex/db erd:check` and fails when this file is stale.",
    "",
  ].join("\n");
}

function generate(): { page: string; tables: number; relationships: number } {
  const entities: Entity[] = [];
  const relationships: Relationship[] = [];
  for (const table of collectTables()) {
    const described = describeTable(table);
    entities.push(described.entity);
    relationships.push(...described.relationships);
  }
  relationships.sort(
    (a, b) =>
      a.parent.localeCompare(b.parent, "en") ||
      a.child.localeCompare(b.child, "en") ||
      a.label.localeCompare(b.label, "en"),
  );
  return {
    page: renderPage(entities, relationships),
    tables: entities.length,
    relationships: relationships.length,
  };
}

function normalise(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

function check(): number {
  const { page } = generate();
  const tempDir = mkdtempSync(join(tmpdir(), "sendex-erd-"));
  const tempPath = join(tempDir, "erd.md");
  try {
    writeFileSync(tempPath, page);
    let committed: string;
    try {
      committed = readFileSync(outputPath, "utf8");
    } catch {
      console.error(`erd:check: ${outputPath} is missing. Run: pnpm --filter @sendex/db erd`);
      return 1;
    }
    const expected = normalise(readFileSync(tempPath, "utf8")).split("\n");
    const actual = normalise(committed).split("\n");
    const firstDifference = expected.findIndex((line, i) => line !== actual[i]);
    if (firstDifference === -1 && expected.length === actual.length) {
      console.log("erd:check: docs/engineering/erd.md is up to date");
      return 0;
    }
    const at = firstDifference === -1 ? expected.length : firstDifference;
    console.error(
      "erd:check: docs/engineering/erd.md is stale (schema changed without regenerating).",
    );
    console.error(`  first difference at line ${at + 1}:`);
    console.error(`    committed: ${JSON.stringify(actual[at] ?? "<end of file>")}`);
    console.error(`    expected:  ${JSON.stringify(expected[at] ?? "<end of file>")}`);
    console.error("  fix: pnpm --filter @sendex/db erd, then commit docs/engineering/erd.md");
    return 1;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function write(): number {
  const { page, tables, relationships } = generate();
  writeFileSync(outputPath, page);
  console.log(`erd: wrote ${outputPath} (${tables} tables, ${relationships} relationships)`);
  return 0;
}

process.exitCode = process.argv.includes("--check") ? check() : write();
