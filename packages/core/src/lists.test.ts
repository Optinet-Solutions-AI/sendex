import { describe, expect, it } from "vitest";
import {
  addUploadSummary,
  applyMapping,
  ColumnMappingSchema,
  cleanUploadRows,
  countDrops,
  countriesList,
  countryByCode,
  defaultListName,
  detectColumns,
  detectListCountry,
  emptyDropCounts,
  emptyUploadSummary,
  flagEmoji,
  importedGood,
  parseCountryCell,
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
    expect(out.summary).toMatchObject({
      rows: 6,
      imported: 0,
      skippedExisting: 0,
      duplicates: batch.duplicates,
      dropped: countDrops(batch.dropped),
      addedBad: { landline: 0, suspicious: 0 },
    });
    expect(out.summary.samples.rejected).toEqual(["912345678", "900123456", "junk"]);
    expect(out.summary.dropped.landline).toBe(1);
    expect(out.summary.dropped.toll_free).toBe(1);
    expect(out.summary.dropped.unparseable).toBe(1);
  });

  it("with keepBad, landlines and suspicious patterns are kept and flagged Bad", () => {
    const out = cleanUploadRows([...rows, { phone: "+34666666666" }, { phone: "+34677000000" }], {
      defaultCountry: "ES",
      removeLandlines: true,
      keepBad: true,
    });
    const byNumber = new Map(out.kept.map((k) => [k.e164, k]));
    expect(byNumber.get("+34912345678")?.bad).toBe("landline");
    expect(byNumber.get("+34666666666")?.bad).toBe("suspicious");
    expect(byNumber.get("+34677000000")?.bad).toBe("suspicious");
    // 612345678 is a straight run, so it is Bad too; 33612345678 (FR) is the same digits.
    expect(byNumber.get("+34612345678")?.bad).toBe("suspicious");
    expect(out.summary.addedBad).toEqual({ landline: 1, suspicious: 4 });
    expect(out.summary.dropped.landline).toBe(0);
    expect(out.summary.dropped.toll_free).toBe(1);
    expect(out.summary.samples.landline).toEqual(["+34912345678"]);
    expect(out.summary.samples.suspicious).toEqual([
      "+34612345678",
      "+33612345678",
      "+34666666666",
      "+34677000000",
    ]);
    expect(importedGood({ ...out.summary, imported: 5 })).toBe(0);
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
  it("lists the nineteen supported countries with ISO-2 codes, names and flags", () => {
    expect(countriesList).toHaveLength(19);
    expect(countriesList.map((c) => c.code)).toContain("PH");
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
    expect(ColumnMappingSchema.safeParse(["phone", "street"]).success).toBe(false);
    expect(
      ColumnMappingSchema.safeParse([
        "phone",
        "country",
        "date_of_birth",
        "gender",
        "state",
        "address",
      ]).success,
    ).toBe(true);
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

  it("detects country, gender, birth date, state and address columns from the header", () => {
    const header = ["Phone", "Country", "DOB", "Gender", "State", "Address"];
    const rows = [["+34600123456", "ES", "1990-01-02", "F", "Madrid", "Calle Mayor 1"]];
    expect(detectColumns(header, rows).columns.map((c) => c.type)).toEqual([
      "phone",
      "country",
      "date_of_birth",
      "gender",
      "state",
      "address",
    ]);
  });

  it("detects a country column by its values when the header says nothing", () => {
    const detected = detectColumns(
      ["c1", "c2"],
      [
        ["+34600123456", "ES"],
        ["+44 7700 900123", "United Kingdom"],
      ],
    );
    expect(detected.columns.map((c) => c.type)).toEqual(["phone", "country"]);
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

  it("maps the SMS Edge profile fields", () => {
    const row = applyMapping(
      ["+34600123456", "es", "1990-01-02", "F", "Madrid", "Calle Mayor 1"],
      ["phone", "country", "date_of_birth", "gender", "state", "address"],
    );
    expect(row).toEqual({
      phone: "+34600123456",
      country: "es",
      dateOfBirth: "1990-01-02",
      gender: "F",
      state: "Madrid",
      address: "Calle Mayor 1",
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

describe("parseCountryCell", () => {
  it("reads ISO codes, UK and country names, in any case", () => {
    expect(parseCountryCell("es")).toBe("ES");
    expect(parseCountryCell(" GB ")).toBe("GB");
    expect(parseCountryCell("UK")).toBe("GB");
    expect(parseCountryCell("united kingdom")).toBe("GB");
    expect(parseCountryCell("Malta")).toBe("MT");
  });

  it("returns undefined for anything else", () => {
    expect(parseCountryCell("")).toBeUndefined();
    expect(parseCountryCell("Narnia")).toBeUndefined();
    expect(parseCountryCell("XX")).toBeUndefined();
  });
});

describe("detectListCountry", () => {
  it("picks the most common country of the country column", () => {
    const rows = [
      ["+34600123456", "ES"],
      ["+34600123457", "Spain"],
      ["+447911123456", "GB"],
      ["+34600123458", "nope"],
    ];
    expect(detectListCountry(rows, ["phone", "country"])).toBe("ES");
  });

  it("returns undefined without a country column or a readable value", () => {
    expect(detectListCountry([["+34600123456", "ES"]], ["phone", "ignore"])).toBeUndefined();
    expect(detectListCountry([["+34600123456", "?"]], ["phone", "country"])).toBeUndefined();
  });
});

describe("defaultListName", () => {
  it("names the list after the file like SMS Edge", () => {
    expect(defaultListName("test-20261107-182922-73362aeb.txt")).toBe(
      "Test 20261107 182922 73362aeb",
    );
    expect(defaultListName("roy boy_ES_batch2.xlsx")).toBe("Roy boy ES batch2");
    expect(defaultListName("")).toBe("");
  });
});

describe("cleanUploadRows with a country column", () => {
  it("parses national numbers against the row's own country", () => {
    const out = cleanUploadRows(
      [
        { phone: "07400 123456", country: "UK" },
        { phone: "612345678", country: "es" },
        { phone: "612345679" },
      ],
      { defaultCountry: "ES", removeLandlines: true },
    );
    expect(out.kept.map((r) => [r.e164, r.country])).toEqual([
      ["+447400123456", "GB"],
      ["+34612345678", "ES"],
      ["+34612345679", "ES"],
    ]);
  });
});
