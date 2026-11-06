import { describe, expect, it } from "vitest";
import {
  addUploadSummary,
  applyMapping,
  ColumnMappingSchema,
  cleanUploadRows,
  countDrops,
  countriesList,
  countryByCode,
  detectColumns,
  emptyDropCounts,
  emptyUploadSummary,
  flagEmoji,
  totalDropped,
  UploadSettingsSchema,
} from "./lists.js";
import { cleanBatch } from "./phone.js";

describe("cleanUploadRows", () => {
  const rows = [
    { phone: "+34 612 345 678", firstName: "Ana" },
    { phone: "612345678", email: "dup@example.com" },
    { phone: "912345678" },
    { phone: "900123456" },
    { phone: "junk" },
    { phone: "+33612345678", custom1: "FR" },
  ];

  it("keeps the contact fields of kept numbers and agrees with cleanBatch", () => {
    const out = cleanUploadRows(rows, { defaultCountry: "ES", removeLandlines: true });
    expect(out.kept).toEqual([
      { e164: "+34612345678", country: "ES", firstName: "Ana" },
      { e164: "+33612345678", country: "FR", custom1: "FR" },
    ]);
    const batch = cleanBatch(
      rows.map((r) => r.phone),
      { defaultCountry: "ES", removeLandlines: true, dedupe: true },
    );
    expect(out.kept.map((k) => k.e164)).toEqual(batch.kept.map((k) => k.e164));
    expect(out.summary).toEqual({
      rows: 6,
      imported: 0,
      skippedExisting: 0,
      duplicates: batch.duplicates,
      dropped: countDrops(batch.dropped),
    });
    expect(out.summary.dropped.landline).toBe(1);
    expect(out.summary.dropped.toll_free).toBe(1);
    expect(out.summary.dropped.unparseable).toBe(1);
  });

  it("keeps landlines when the logical check is off", () => {
    const out = cleanUploadRows(rows, { defaultCountry: "ES", removeLandlines: false });
    expect(out.kept.map((k) => k.e164)).toContain("+34912345678");
    expect(out.summary.dropped.landline).toBe(0);
  });

  it("sums summaries", () => {
    const a = cleanUploadRows(rows.slice(0, 3), { defaultCountry: "ES", removeLandlines: true });
    const b = cleanUploadRows(rows.slice(3), { defaultCountry: "ES", removeLandlines: true });
    const total = addUploadSummary(a.summary, b.summary);
    expect(total.rows).toBe(6);
    expect(total.dropped.landline).toBe(1);
    expect(totalDropped(total)).toBe(3);
    expect(emptyUploadSummary().rows).toBe(0);
  });
});

describe("countriesList", () => {
  it("lists the eighteen supported countries with ISO-2 codes, names and flags", () => {
    expect(countriesList).toHaveLength(18);
    const gb = countriesList.find((c) => c.code === "GB");
    expect(gb).toEqual({ code: "GB", name: "United Kingdom", flag: "🇬🇧" });
    expect(countriesList.map((c) => c.code)).toContain("DZ");
    expect(countriesList.some((c) => (c.code as string) === "UK")).toBe(false);
  });

  it("builds a flag from any ISO-2 code and looks countries up by code", () => {
    expect(flagEmoji("ES")).toBe("🇪🇸");
    expect(flagEmoji("es")).toBe("🇪🇸");
    expect(countryByCode("FR")?.name).toBe("France");
    expect(countryByCode("XX")).toBeUndefined();
  });
});

describe("UploadSettingsSchema", () => {
  it("applies the defaults: logical check on, skip existing duplicates, no flush", () => {
    const parsed = UploadSettingsSchema.parse({
      target: { kind: "new", name: "Roy Boy_ES", country: "ES" },
    });
    expect(parsed).toEqual({
      target: { kind: "new", name: "Roy Boy_ES", country: "ES" },
      logicalCheck: true,
      duplicates: "skip_existing",
      flushAfterImport: false,
    });
  });

  it("accepts an existing list target by uuid", () => {
    const parsed = UploadSettingsSchema.parse({
      target: { kind: "existing", listId: "2d1c4e1e-4b8e-4d1a-9f5b-7a0f1a2b3c4d" },
      logicalCheck: false,
      duplicates: "allow",
      flushAfterImport: true,
    });
    expect(parsed.target.kind).toBe("existing");
    expect(parsed.logicalCheck).toBe(false);
  });

  it("rejects a blank or over-long name, an unsupported country and a bad list id", () => {
    expect(
      UploadSettingsSchema.safeParse({ target: { kind: "new", name: "  ", country: "ES" } })
        .success,
    ).toBe(false);
    expect(
      UploadSettingsSchema.safeParse({
        target: { kind: "new", name: "x".repeat(101), country: "ES" },
      }).success,
    ).toBe(false);
    expect(
      UploadSettingsSchema.safeParse({ target: { kind: "new", name: "List", country: "UK" } })
        .success,
    ).toBe(false);
    expect(
      UploadSettingsSchema.safeParse({ target: { kind: "existing", listId: "not-a-uuid" } })
        .success,
    ).toBe(false);
  });
});

describe("ColumnMappingSchema", () => {
  it("requires exactly one phone column and no repeated field", () => {
    expect(ColumnMappingSchema.safeParse(["phone", "first_name", "ignore"]).success).toBe(true);
    expect(ColumnMappingSchema.safeParse(["first_name", "ignore"]).success).toBe(false);
    expect(ColumnMappingSchema.safeParse(["phone", "phone"]).success).toBe(false);
    expect(ColumnMappingSchema.safeParse(["phone", "custom1", "custom1"]).success).toBe(false);
    expect(ColumnMappingSchema.safeParse(["phone", "ignore", "ignore"]).success).toBe(true);
    expect(ColumnMappingSchema.safeParse(["phone", "address"]).success).toBe(false);
  });
});

describe("detectColumns", () => {
  it("finds the phone column among others and names columns from the header", () => {
    const header = ["Name", "Surname", "Mobile", "E-mail"];
    const rows = [
      ["Ana", "García", "+34 600 123 456", "ana@example.com"],
      ["Luis", "Pérez", "0034600123457", "luis@example.com"],
      ["Eva", "Ruiz", "+34600123458", "eva@example.com"],
    ];
    const detected = detectColumns(header, rows);
    expect(detected.hasHeader).toBe(true);
    expect(detected.columns.map((c) => c.name)).toEqual(["Name", "Surname", "Mobile", "E-mail"]);
    expect(detected.columns.map((c) => c.type)).toEqual([
      "first_name",
      "last_name",
      "phone",
      "email",
    ]);
  });

  it("treats a first row that is itself a phone number as data, not a header", () => {
    const detected = detectColumns(["+34600123456"], [["+34600123457"], ["+34600123458"]]);
    expect(detected.hasHeader).toBe(false);
    expect(detected.columns).toEqual([{ index: 0, name: "Column 1", type: "phone" }]);
  });

  it("uses the default country for national numbers and maps unknown headers to custom fields", () => {
    const header = ["telefono", "promo", "source", "a", "b", "c", "d"];
    const rows = [
      ["600123456", "X1", "fb", "1", "2", "3", "4"],
      ["600123457", "X2", "ig", "1", "2", "3", "4"],
    ];
    const detected = detectColumns(header, rows, "ES");
    expect(detected.columns.map((c) => c.type)).toEqual([
      "phone",
      "custom1",
      "custom2",
      "custom3",
      "custom4",
      "custom5",
      "ignore",
    ]);
  });

  it("detects an email column by its values when the header says nothing", () => {
    const detected = detectColumns(
      ["c1", "c2"],
      [
        ["+34600123456", "a@b.com"],
        ["+34600123457", "c@d.com"],
      ],
    );
    expect(detected.columns.map((c) => c.type)).toEqual(["phone", "email"]);
  });

  it("falls back to the first column as phone when nothing parses", () => {
    const detected = detectColumns(["x", "y"], [["foo", "bar"]]);
    expect(detected.columns.map((c) => c.type)).toEqual(["phone", "custom1"]);
  });
});

describe("applyMapping", () => {
  it("turns a raw row into an upload row following the mapping", () => {
    const row = applyMapping(
      ["Ana", "+34600123456", "x", "ana@example.com", "VIP"],
      ["first_name", "phone", "ignore", "email", "custom2"],
    );
    expect(row).toEqual({
      phone: "+34600123456",
      firstName: "Ana",
      email: "ana@example.com",
      custom2: "VIP",
    });
  });

  it("trims values and drops empty ones", () => {
    const row = applyMapping(["  +34600123456 ", "  "], ["phone", "last_name"]);
    expect(row).toEqual({ phone: "+34600123456" });
  });
});

describe("drop counts", () => {
  it("starts at zero for every reason and sums a batch's drops", () => {
    expect(emptyDropCounts()).toEqual({
      invalid: 0,
      unparseable: 0,
      no_country: 0,
      landline: 0,
      premium: 0,
      toll_free: 0,
      voip: 0,
    });
    const counts = countDrops([
      { raw: "a", reason: "landline" },
      { raw: "b", reason: "landline" },
      { raw: "c", reason: "invalid" },
    ]);
    expect(counts.landline).toBe(2);
    expect(counts.invalid).toBe(1);
    expect(counts.premium).toBe(0);
  });
});
