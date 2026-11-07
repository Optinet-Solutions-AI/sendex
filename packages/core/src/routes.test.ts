import { describe, expect, it } from "vitest";
import {
  customRouteSchema,
  expandTestCombos,
  fillPlaceholders,
  generateSenderId,
  mobileNetworks,
  orderRoutes,
  presetText,
  priceEurToMicro,
  scheduleDue,
  scheduleSlot,
  smsTestSchema,
  splitCustomRoute,
  TIME_SLOTS,
  testCostEstimate,
} from "./routes.js";

describe("customRouteSchema / splitCustomRoute", () => {
  it("accepts an HTTP route with placeholders and seals only the password", () => {
    const parsed = customRouteSchema.parse({
      type: "http",
      name: "My Route",
      apiUrl: "https://api.provider.com/sms?from={{{from}}}&to={{{number}}}&text={{{text}}}",
      username: "u",
      password: "p",
      headers: [{ name: "X-Key", value: "k" }],
    });
    expect(parsed.type === "http" && parsed.usePost).toBe(true);
    const split = splitCustomRoute(parsed);
    expect(split.provider).toBe("custom-http");
    expect(split.host).toBe("api.provider.com");
    expect(split.config).toMatchObject({ usePost: true, username: "u" });
    expect(split.config).not.toHaveProperty("password");
    expect(split.secret).toEqual({ password: "p" });
  });

  it("refuses an HTTP route without the number placeholder and an SMPP route without a host", () => {
    expect(
      customRouteSchema.safeParse({ type: "http", name: "x", apiUrl: "https://a.b/send" }).success,
    ).toBe(false);
    expect(
      customRouteSchema.safeParse({ type: "smpp", name: "x", systemId: "s", password: "p" })
        .success,
    ).toBe(false);
    const smpp = customRouteSchema.parse({
      type: "smpp",
      name: "23Telecom",
      host: "smpp.23telecom.com",
      port: "2875",
      systemId: "Sendex",
      password: "secret",
    });
    const split = splitCustomRoute(smpp);
    expect(split.provider).toBe("custom-smpp");
    expect(split.host).toBe("smpp.23telecom.com:2875");
    expect(split.config).toMatchObject({ port: 2875, tls: false });
  });

  it("fills placeholders, encoding them in a URL", () => {
    expect(
      fillPlaceholders(
        "https://x/?to={{{number}}}&t={{{text}}}&f={{{from}}}",
        {
          from: "Sendex",
          number: "34600000000",
          text: "hi there",
        },
        true,
      ),
    ).toBe("https://x/?to=34600000000&t=hi%20there&f=Sendex");
  });

  it("converts EUR prices to micro", () => {
    expect(priceEurToMicro("0.0357")).toBe(35_700n);
    expect(priceEurToMicro("1")).toBe(1_000_000n);
    expect(priceEurToMicro("0.01")).toBe(10_000n);
  });
});

describe("orderRoutes", () => {
  const routes = [
    { id: "p1", platform: true, priceMicro: 30_000n },
    { id: "p2", platform: true, priceMicro: 20_000n },
    { id: "c1", platform: false, priceMicro: 38_000n },
    { id: "c2", platform: false, priceMicro: null },
  ];
  const ids = (r: typeof routes) => r.map((x) => x.id);

  it("orders by strategy with unpriced routes last in their group", () => {
    expect(ids(orderRoutes(routes, "custom_first"))).toEqual(["c1", "c2", "p2", "p1"]);
    expect(ids(orderRoutes(routes, "platform_first"))).toEqual(["p2", "p1", "c1", "c2"]);
    expect(ids(orderRoutes(routes, "blended"))).toEqual(["p2", "p1", "c1", "c2"]);
  });

  it("applies the exception: explicit order, disabled routes and a locked route", () => {
    expect(
      ids(
        orderRoutes(routes, "custom_first", {
          routeOrder: ["p1"],
          disabledRoutes: ["c2"],
          lockedRoute: null,
        }),
      ),
    ).toEqual(["p1", "c1", "p2"]);
    expect(
      ids(
        orderRoutes(routes, "custom_first", {
          routeOrder: [],
          disabledRoutes: [],
          lockedRoute: "p2",
        }),
      ),
    ).toEqual(["p2"]);
    // A locked route that is disabled falls back to the strategy.
    expect(
      ids(
        orderRoutes(routes, "platform_first", {
          routeOrder: [],
          disabledRoutes: ["p2"],
          lockedRoute: "p2",
        }),
      ),
    ).toEqual(["p1", "c1", "c2"]);
  });
});

describe("send single inputs", () => {
  const rng = () => 0.42;

  it("generates sender ids and texts per mode and preset", () => {
    expect(generateSenderId("random_string", null, rng)).toMatch(/^[A-Z]{5}$/);
    expect(generateSenderId("random_casino", null, rng)).toBe("SpinPalace");
    expect(generateSenderId("custom", " MyBrand ", rng)).toBe("MyBrand");
    expect(presetText("hi_no_domain")).toBe("Hi, how are you?");
    expect(presetText("casino_new_domain", { rng })).toMatch(/^200 free spins .* https:\/\//);
    expect(presetText("custom", { custom: "Yo" })).toBe("Yo");
    expect(presetText("random_history", { history: ["a", "b"], rng })).toBe("a");
  });

  it("validates a single send and its custom fields", () => {
    const base = {
      type: "single",
      country: "ad",
      recipient: "376600000",
      routeIds: ["0f1d6c62-6f5a-4a2a-9a1b-1c2d3e4f5a6b"],
      senderModes: ["random_string", "custom"],
      textPresets: ["hi_no_domain"],
    };
    expect(smsTestSchema.safeParse(base).success).toBe(false); // custom sender missing
    const ok = smsTestSchema.parse({ ...base, customSender: "Brand" });
    expect(ok.country).toBe("AD");
    expect(ok.schedule).toBeNull();
    expect(
      smsTestSchema.safeParse({ ...base, senderModes: ["random_string"], recipient: "" }).success,
    ).toBe(false);
    expect(
      smsTestSchema.safeParse({
        ...base,
        senderModes: ["random_string"],
        schedule: { days: [1, 7], times: ["09:00", "09:10"] },
      }).success,
    ).toBe(false);
  });

  it("multiplies tests by combination and route, and estimates the cost", () => {
    const combos = expandTestCombos({
      senderModes: ["random_string", "random_shop"],
      textPresets: ["hi_no_domain", "custom", "telegram_invite"],
    });
    expect(combos).toHaveLength(6);
    const routes = [{ priceMicro: 40_000n }, { priceMicro: 10_000n }];
    expect(testCostEstimate({ combos: 6, routes, cascade: false })).toEqual({
      rows: [{ type: "Single SMS", tests: 12, costMicro: 300_000n }],
      tests: 12,
      totalMicro: 300_000n,
    });
    expect(testCostEstimate({ combos: 6, routes, cascade: true })).toMatchObject({
      tests: 6,
      totalMicro: 240_000n,
    });
    expect(testCostEstimate({ combos: 2, routes: [], cascade: false }).rows).toEqual([]);
  });

  it("floors the schedule to 15-minute UTC slots and fires once per slot", () => {
    expect(TIME_SLOTS).toHaveLength(96);
    expect(TIME_SLOTS[0]).toBe("00:00");
    expect(TIME_SLOTS[95]).toBe("23:45");
    // 7 Nov 2026 is a Saturday.
    const now = new Date("2026-11-07T09:17:00Z");
    expect(scheduleSlot(now)).toEqual({ day: 6, time: "09:15", key: "2026-11-07T09:15" });
    const schedule = { days: [6], times: ["09:15"] };
    expect(scheduleDue(schedule, now, null)?.key).toBe("2026-11-07T09:15");
    expect(scheduleDue(schedule, now, "2026-11-07T09:15")).toBeNull();
    expect(scheduleDue({ days: [1], times: ["09:15"] }, now, null)).toBeNull();
  });
});

describe("mobileNetworks", () => {
  const stats = [
    {
      country: "FR",
      operator: "Altice",
      routeId: "r1",
      routeName: "375",
      sent: 8015,
      previews: 10,
      clicks: 205,
      leads: 7,
      sales: 0,
    },
    {
      country: "FR",
      operator: "Altice",
      routeId: "r2",
      routeName: "403",
      sent: 1545,
      previews: 2,
      clicks: 16,
      leads: 0,
      sales: 0,
    },
    {
      country: "FR",
      operator: "Orange",
      routeId: "r1",
      routeName: "375",
      sent: 12311,
      previews: 0,
      clicks: 357,
      leads: 9,
      sales: 1,
    },
    {
      country: "FR",
      operator: "Tiny",
      routeId: "r1",
      routeName: "375",
      sent: 40,
      previews: 0,
      clicks: 4,
      leads: 0,
      sales: 0,
    },
    {
      country: "PL",
      operator: "P4",
      routeId: "r1",
      routeName: "375",
      sent: 5000,
      previews: 0,
      clicks: 100,
      leads: 1,
      sales: 0,
    },
  ];

  it("groups by country and operator, hides low volume and computes deltas and shares", () => {
    const view = mobileNetworks(stats);
    expect(view.countries.map((c) => c.country)).toEqual(["FR", "PL"]);
    const fr = view.countries[0];
    expect(fr?.networks.map((n) => n.operator)).toEqual(["Orange", "Altice"]);
    const altice = fr?.networks[1];
    expect(altice?.sent).toBe(9560);
    expect(altice?.clicks).toBe(221);
    expect(altice?.routes.map((r) => r.routeName)).toEqual(["375", "403"]);
    expect(altice?.share).toBeCloseTo(9560 / 21911, 4);
    expect(altice?.ctrDelta).toBeCloseTo(221 / 9560 - 582 / 21911, 6);
    expect(view.hiddenCount).toBe(1);
    expect(view.kpis).toMatchObject({
      countries: 2,
      networks: 3,
      sent: 26871,
      leads: 17,
      sales: 1,
    });
  });

  it("shows low-volume networks on request", () => {
    const view = mobileNetworks(stats, { showLowVolume: true });
    expect(view.countries[0]?.networks.map((n) => n.operator)).toEqual([
      "Orange",
      "Altice",
      "Tiny",
    ]);
    expect(view.countries[0]?.networks[2]?.lowVolume).toBe(true);
    expect(view.hiddenCount).toBe(1);
  });
});
