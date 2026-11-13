# Lists: queries and the import pipeline

Cards D1-16 (upload), D1-17/18 (lists table) and D1-19 (flush). User guide:
`docs/using/upload-a-list.md`.

## Tables

`packages/db/src/schema/lists.ts`:

| Table | Role |
| --- | --- |
| `contacts` | One row per phone number per organisation, unique on `(organisation_id, e164)`. Holds the contact fields (`first_name`, `last_name`, `email`, `custom1..5`). |
| `lists` | A named, single-country list. `numbers_count` is denormalised and refreshed by the import and flush helpers; `last_upload_at` and `last_sent_at` feed the table. |
| `list_members` | Membership of a contact in a list, unique on `(list_id, contact_id)`. `sent_at` is set by the campaign engine, `flushed_at` by a flush, `bad` / `bad_reason` by carriers or validation. |
| `suppressions` | Numbers the organisation must never message. |

## Queries (`packages/db/src/queries/lists.ts`)

All take `(db, organisationId, …)` and scope every statement by organisation
(AGENTS.md rule 4). Tested on PGlite in `lists.test.ts`.

| Function | What it does |
| --- | --- |
| `listLists(db, org, { search?, country?, sort?, dir?, page?, pageSize })` | Rows for the table: name, `numbersCount`, country, `sent` (members with `sent_at`), `lastSentAt`, `lastUploadAt`, `createdAt`, plus `total` for paging. `search` is a case-insensitive substring match on the name; sort keys are `LIST_SORT_KEYS` from `@sendex/core`. |
| `listListNames(db, org)` | `{ id, name, country }` for selects. |
| `getList(db, org, listId)` | The row plus `counts: { members, available, sent, bad }`, or `null` when the list is not this organisation's. |
| `listAvailableCount(db, org, listId)` | Members not bad, with `sent_at` null (flushed members count as available) and whose number is not in `suppressions`. |
| `listMembersPage(db, org, listId, { page, pageSize })` | A page of members joined to their contact, for the detail screen. |
| `createList`, `deleteList` | Create a list; delete one (members cascade, contacts stay). |
| `importContacts(db, org, { listId \| newList, rows, duplicates, flushAfterImport })` | The import (below). Returns `{ listId, imported, skippedExisting }`. |
| `flushList(db, org, listId)` | `sent_at = null, flushed_at = now()` on every member; `bad` is untouched. Returns the member count. |
| `flushAllLists(db, org)` | `flushList` on every list of the organisation. |

`recordAudit` in `queries/audit.ts` appends an `audit_log` row; the lists actions use it for
`list.upload`, `list.flush` and `list.flush_all`.

## Import pipeline

```
browser                                  server action (apps/web/app/(dashboard)/lists/actions.ts)
-------                                  -----------------------------------------------------
file / paste
  → papaparse (delimiter auto)
  → detectColumns()           core
  → user fixes mapping + settings
  → startUpload(settings)     ────────→  requireAction("list.upload"), UploadSettingsSchema,
                                         createList or getList → { listId, country }
  for each 5,000 rows:
    applyMapping()            core
    importChunk({ listId, rows, logicalCheck, duplicates })
                              ────────→  requireAction, Zod, cleanUploadRows(rows, {
                                           defaultCountry: list.country,
                                           removeLandlines: logicalCheck })      core
                                         importContacts(kept)                   db
                                         ← chunk summary (imported, skipped, dropped by reason)
  → finishUpload({ listId, flushAfterImport, summary })
                              ────────→  requireAction, optional flushList, recordAudit("list.upload")
summary screen
```

### Pure parts (`packages/core/src/lists.ts`)

- `UploadSettingsSchema`: `target` (`{ kind: "existing", listId }` or
  `{ kind: "new", name 1..100, country }`), `logicalCheck` (default `true`), `duplicates`
  (`skip_existing` default | `allow`), `flushAfterImport` (default `false`).
- `ColumnMappingSchema`: array of column types by index; exactly one `phone`, no other field twice.
- `detectColumns(headerRow, sampleRows, defaultCountry?)`: the phone column is the one where
  most values parse (`normalisePhone`) or look like a phone; the first row is a header unless
  its phone cell is itself a number; other columns are typed from header hints
  (`first_name`, `last_name`, `email`, `country`, `date_of_birth`, `gender`, `state`, `address`)
  or by value (`email`, `country`), then `custom1..custom5`, then `ignore`. The UI default for
  `duplicates` is `allow`, as in SMS Edge.
- `applyMapping(cells, mapping)`: a parsed row to an `UploadRow` (`phone` plus optional fields;
  `country` is the raw cell).
- `parseCountryCell`, `detectListCountry(rows, mapping)`: "Auto-detect from file" takes the most
  common readable value of the country column as the new list's country.
- `defaultListName(fileName)`: the proposed New List Name.
- `cleanUploadRows(rows, { defaultCountry, removeLandlines })`: `cleanBatch` with the contact
  fields carried along: `normalisePhone` (against the row's own country cell when it reads,
  else `defaultCountry`) → `logicalCheck` → in-chunk dedupe. Returns the kept
  rows and an `UploadSummary` with `dropped` counted by `DropReason`.
- `normalisePhone(raw, defaultCountry)` and a number without a plus: it can be a local number
  of `defaultCountry` or an international one missing its plus (`4915155501234`). Both readings
  are tried. When both are valid the mobile one wins; when neither or both are mobile the
  international one wins if it is in `defaultCountry`, else the local one. Before 2026-11-12
  the local reading always won, and Germany's loose plan accepts almost anything as a landline,
  so a whole SMS Edge export of German mobiles was flagged Bad (landline).
- `isSpreadsheetDamaged(raw)`: scientific notation (`4.91516E+12`), what a spreadsheet
  program leaves of a long number when it re-saves a CSV. `normalisePhone` reports it as
  `damaged` and never reads its digits; `countSpreadsheetDamaged` feeds the warning on the
  import step. `dropped.damaged` defaults to 0 when a stored summary predates it.
- `importContacts` returns `importedBad` (landline, suspicious): the Bad members it actually
  inserted. `importChunk` puts that in the summary's `addedBad`, so a Bad number skipped as
  already in the list is not counted as added.
- `countriesList`: the eighteen supported countries (`LIST_COUNTRY_CODES`) with name and flag.
  The UK is `GB` in the database and "United Kingdom" on screen; the seed names lists `_UK_`.

### Database part (`importContacts`)

1. Resolve the target list (create it for `newList`; verify ownership for `listId`).
2. Per chunk of 1,000 rows:
   - with `skip_existing`, select the organisation's contacts for those numbers and drop the
     rows that already exist;
   - upsert the rest into `contacts` on `(organisation_id, e164)`; a provided field overwrites
     the stored one, a missing field keeps it (`coalesce(excluded.x, contacts.x)`);
   - insert `list_members` with `onConflictDoNothing` on `(list_id, contact_id)`.
3. Recount `lists.numbers_count` and set `last_upload_at`.
4. `flushList` when `flushAfterImport` is set.

`imported` is the number of member rows inserted; `skippedExisting` is `rows - imported`.
Dedupe inside a chunk is done by `cleanUploadRows`; a number repeated across chunks is caught
by the unique indexes and counted as skipped rather than as a duplicate.

### Limits

- File: 10 MB, `.csv` or `.txt`, parsed in the browser.
- Server action body: `serverActions.bodySizeLimit` is 4 MB in `next.config.ts`; a chunk of
  5,000 rows with a few fields is well under that.
- Numbers are never logged. The detail screen shows full numbers because it is the contacts
  area; audit details hold counts only.

## Screens

- `app/(dashboard)/lists/page.tsx` + `lists-table.tsx`: the table (`DataTable` from
  `@sendex/ui`, server-side sort and paging through the URL: `?search&country&sort&dir&page`,
  parsed by `lib/lists-params.ts`). CTR, leads, sales and spend show a dash until the campaign
  engine reports per-list stats (D2-13).
- `lists/export/route.ts`: streams the same rows as CSV (`lib/csv.ts` quotes cells and
  neutralises spreadsheet formulas).
- `lists/upload/`: the upload form (client) and its page.
- `lists/[id]/page.tsx`: detail with counts, dates, flush and a page of members.

Permissions: pages call `requireAction("list.view")`, the upload actions `list.upload`, the
flush actions `list.flush`. Buttons are hidden when `can(role, action)` is false, and the
actions check again on the server.

## Tests

- `packages/core/src/lists.test.ts`: schemas, detection, mapping, cleaning.
- `packages/db/src/queries/lists.test.ts`: import, duplicates modes, chunking, flush,
  availability with suppressions, listing, sorting, paging, tenancy.
- `apps/web/lib/*.test.ts`: URL state and CSV lines.
- `apps/web/e2e/lists.spec.ts`: table, search and filter, export, paste-upload of
  `e2e/fixtures/es-numbers.csv` (17 mobiles, 2 landlines, 1 invalid), summary, flush from the
  row menu, detail counts. The spec names its list `E2E ES <timestamp>` and deletes the list
  and its contacts before and after through `e2e/helpers/db.ts`, so it can run repeatedly.
- `apps/web/e2e/lists-upload-numbers.spec.ts`: a pasted German list with two country-code
  numbers (Good) and two spreadsheet-damaged cells (warning before the import, rejected as
  damaged, named on the Files page).
