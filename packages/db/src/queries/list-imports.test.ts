import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestDb, seedOrganisation, type TestDb } from "../test/db.js";
import {
  createListImport,
  deleteListImport,
  getListImport,
  listListImports,
} from "./list-imports.js";
import { createList } from "./lists.js";

let t: TestDb;
let org: string;
let other: string;
let listId: string;

const counts = {
  rowsInFile: 4_346,
  valid: 4_345,
  added: 4_342,
  addedGood: 4_047,
  addedBad: 295,
  rejected: 1,
  skipped: 3,
  duplicates: 0,
  dedup: true,
};

beforeAll(async () => {
  t = await createTestDb();
  org = await seedOrganisation(t.db, "org-a");
  other = await seedOrganisation(t.db, "org-b");
  listId = (await createList(t.db, org, { name: "Roy Boy_DE_Batch3", country: "DE" })).id;
});

afterAll(async () => {
  await t.close();
});

describe("list imports", () => {
  it("records an import with its counts and summary, scoped to the list's organisation", async () => {
    const job = await createListImport(t.db, org, {
      listId,
      fileName: "batch3-20261106-142613-b09a5022.csv",
      source: "file",
      ...counts,
      summary: { samples: { landline: ["+4930123456"] } },
    });
    expect(job).toMatchObject({ status: "done", ...counts });
    await expect(
      createListImport(t.db, other, {
        listId,
        fileName: "x.csv",
        source: "file",
        ...counts,
        summary: {},
      }),
    ).rejects.toThrow(/not found/i);
    await createListImport(t.db, org, {
      listId,
      fileName: "pasted numbers",
      source: "paste",
      status: "failed",
      ...counts,
      summary: {},
    });

    const all = await listListImports(t.db, org, { page: 1, pageSize: 10 });
    expect(all.total).toBe(2);
    expect(all.rows[0]).toMatchObject({
      fileName: "pasted numbers",
      listName: "Roy Boy_DE_Batch3",
    });
    const search = await listListImports(t.db, org, { search: "batch3", page: 1, pageSize: 10 });
    expect(search.rows.map((r) => r.fileName)).toEqual(["batch3-20261106-142613-b09a5022.csv"]);
    const failed = await listListImports(t.db, org, { status: "failed", page: 1, pageSize: 10 });
    expect(failed.total).toBe(1);
    expect((await listListImports(t.db, other, { page: 1, pageSize: 10 })).total).toBe(0);

    const one = await getListImport(t.db, org, job.id);
    expect(one?.summary).toEqual({ samples: { landline: ["+4930123456"] } });
    expect(await getListImport(t.db, other, job.id)).toBeNull();

    expect(await deleteListImport(t.db, other, job.id)).toBe(false);
    expect(await deleteListImport(t.db, org, job.id)).toBe(true);
    expect((await listListImports(t.db, org, { listId, page: 1, pageSize: 10 })).total).toBe(1);
  });
});
