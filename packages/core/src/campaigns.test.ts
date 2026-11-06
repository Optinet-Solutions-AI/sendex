import { describe, expect, it } from "vitest";
import {
  adTextSchema,
  countryOptions,
  flagEmoji,
  hasDomainPlaceholder,
  LINK_PLACEHOLDERS,
  linkSchema,
  newCampaignSchema,
  parseSenderIds,
  renderPreview,
  senderIdsInputSchema,
  sendSettingsSchema,
  sidGroupSchema,
  splitAdTexts,
  TEXT_PLACEHOLDERS,
  timezoneForCountry,
  timezoneOptions,
} from "./campaigns.js";

describe("newCampaignSchema", () => {
  it("accepts a name, an ISO-2 country and an IANA timezone", () => {
    const parsed = newCampaignSchema.parse({
      name: " Roy Boy ES ",
      country: "es",
      timezone: "Europe/Madrid",
    });
    expect(parsed).toEqual({ name: "Roy Boy ES", country: "ES", timezone: "Europe/Madrid" });
  });

  it("rejects an empty name, a name over 120 chars, a bad country and a bad timezone", () => {
    const base = { name: "x", country: "ES", timezone: "Europe/Madrid" };
    expect(newCampaignSchema.safeParse({ ...base, name: "  " }).success).toBe(false);
    expect(newCampaignSchema.safeParse({ ...base, name: "a".repeat(121) }).success).toBe(false);
    expect(newCampaignSchema.safeParse({ ...base, country: "ESP" }).success).toBe(false);
    expect(newCampaignSchema.safeParse({ ...base, timezone: "Mars/Olympus" }).success).toBe(false);
  });
});

describe("sidGroupSchema and sender ids", () => {
  it("validates a group name and country", () => {
    expect(sidGroupSchema.parse({ name: "ES Casino", country: "ES" })).toEqual({
      name: "ES Casino",
      country: "ES",
    });
    expect(sidGroupSchema.safeParse({ name: "", country: "ES" }).success).toBe(false);
  });

  it("parses one per line or comma separated, trims and dedupes", () => {
    expect(parseSenderIds("LUCKY777, BONUS777\nlucky777\n\n  VIPCLUB ,BONUS777")).toEqual([
      "LUCKY777",
      "BONUS777",
      "lucky777",
      "VIPCLUB",
    ]);
  });

  it("rejects values outside 3..11 alphanumeric characters and an empty input", () => {
    expect(senderIdsInputSchema.safeParse("AB").success).toBe(false);
    expect(senderIdsInputSchema.safeParse("ABCDEFGHIJKL").success).toBe(false);
    expect(senderIdsInputSchema.safeParse("LUCKY 777").success).toBe(false);
    expect(senderIdsInputSchema.safeParse("LUCKY-777").success).toBe(false);
    expect(senderIdsInputSchema.safeParse("\n,\n").success).toBe(false);
    expect(senderIdsInputSchema.parse("LUCKY777,BONUS777")).toEqual(["LUCKY777", "BONUS777"]);
  });
});

describe("adTextSchema and splitAdTexts", () => {
  it("accepts 1..1000 characters", () => {
    expect(adTextSchema.parse({ text: "Hi {{domain}}" })).toEqual({ text: "Hi {{domain}}" });
    expect(adTextSchema.safeParse({ text: "" }).success).toBe(false);
    expect(adTextSchema.safeParse({ text: "a".repeat(1001) }).success).toBe(false);
  });

  it("splits several texts on a line containing only //", () => {
    expect(splitAdTexts("First {{domain}}\n//\nSecond {{domain}}\n  //  \nThird")).toEqual([
      "First {{domain}}",
      "Second {{domain}}",
      "Third",
    ]);
    expect(splitAdTexts("Only one // inline")).toEqual(["Only one // inline"]);
    expect(splitAdTexts("\n//\n")).toEqual([]);
  });
});

describe("linkSchema", () => {
  it("accepts http(s) urls with placeholders", () => {
    const parsed = linkSchema.parse({
      name: "Trixino",
      url: "https://trk.example.com/click?o=75&sub_id1={{dynamic}}&geo={{geo}}",
    });
    expect(parsed.name).toBe("Trixino");
  });

  it("rejects non-http schemes and junk", () => {
    expect(linkSchema.safeParse({ name: "x", url: "ftp://example.com" }).success).toBe(false);
    expect(linkSchema.safeParse({ name: "x", url: "not a url" }).success).toBe(false);
    expect(linkSchema.safeParse({ name: "", url: "https://example.com" }).success).toBe(false);
  });
});

describe("sendSettingsSchema", () => {
  it("defaults test size to 200, reuse to account_wide and send now", () => {
    expect(sendSettingsSchema.parse({})).toEqual({
      testSize: 200,
      contactReuse: "account_wide",
      sendAll: false,
      sendNow: true,
    });
  });

  it("bounds the test size and requires a start time when not sending now", () => {
    expect(sendSettingsSchema.safeParse({ testSize: 0 }).success).toBe(false);
    expect(sendSettingsSchema.safeParse({ testSize: 100_001 }).success).toBe(false);
    expect(sendSettingsSchema.safeParse({ testSize: 1.5 }).success).toBe(false);
    expect(sendSettingsSchema.safeParse({ sendNow: false }).success).toBe(false);
    expect(sendSettingsSchema.safeParse({ sendNow: false, scheduledAt: "soon" }).success).toBe(
      false,
    );
    const parsed = sendSettingsSchema.parse({
      sendNow: false,
      scheduledAt: "2026-09-14T10:00:00.000Z",
      contactReuse: "per_campaign",
    });
    expect(parsed.scheduledAt).toBe("2026-09-14T10:00:00.000Z");
    expect(parsed.contactReuse).toBe("per_campaign");
  });
});

describe("timezones and countries", () => {
  it("maps countries to their zone and falls back to UTC", () => {
    expect(timezoneForCountry("ES")).toBe("Europe/Madrid");
    expect(timezoneForCountry("gb")).toBe("Europe/London");
    expect(timezoneForCountry("NZ")).toBe("Pacific/Auckland");
    expect(timezoneForCountry("XX")).toBe("UTC");
  });

  it("offers every mapped zone once, plus UTC, sorted", () => {
    expect(timezoneOptions).toContain("Europe/Madrid");
    expect(timezoneOptions).toContain("UTC");
    expect(new Set(timezoneOptions).size).toBe(timezoneOptions.length);
    expect([...timezoneOptions].sort()).toEqual(timezoneOptions);
  });

  it("lists countries with a name and a flag", () => {
    const spain = countryOptions.find((c) => c.code === "ES");
    expect(spain).toEqual({ code: "ES", name: "Spain", flag: "🇪🇸" });
    expect(flagEmoji("GB")).toBe("🇬🇧");
  });
});

describe("placeholders", () => {
  it("defines the text and link placeholders", () => {
    expect(TEXT_PLACEHOLDERS.map((p) => p.key)).toEqual([
      "domain",
      "first_name",
      "last_name",
      "phone",
      "opt_out",
      "random",
    ]);
    expect(LINK_PLACEHOLDERS).toContain("dynamic");
    expect(LINK_PLACEHOLDERS).toContain("custom5");
    expect(LINK_PLACEHOLDERS).toContain("cost");
    expect(LINK_PLACEHOLDERS).toHaveLength(18);
  });

  it("detects the domain placeholder", () => {
    expect(hasDomainPlaceholder("Win now {{domain}}")).toBe(true);
    expect(hasDomainPlaceholder("Win now {{ domain }}")).toBe(true);
    expect(hasDomainPlaceholder("Win now")).toBe(false);
  });

  it("renders a preview with sample values and picks the first randomizer option", () => {
    const out = renderPreview("{Hi|Hello} {{first_name}}, open {{domain}} {{unknown}}", {
      first_name: "Ana",
      domain: "https://snd.ex/abc",
    });
    expect(out).toBe("Hi Ana, open https://snd.ex/abc {{unknown}}");
  });
});
