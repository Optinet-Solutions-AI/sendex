import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { RATE_LIMITS, type RateLimitInput, type RateLimitResult } from "./rate-limit.js";
import { rateLimit } from "./rate-limit-middleware.js";

function fakeLimiter(decide: (input: RateLimitInput) => RateLimitResult) {
  const seen: RateLimitInput[] = [];
  return {
    seen,
    limiter: {
      async limit(input: RateLimitInput): Promise<RateLimitResult> {
        seen.push(input);
        return decide(input);
      },
    },
  };
}

describe("rateLimit middleware", () => {
  it("passes through with RateLimit-* headers when allowed", async () => {
    const { seen, limiter } = fakeLimiter((input) => ({
      allowed: true,
      remaining: input.max - 1,
      resetMs: 60_000,
      limit: input.max,
    }));
    const app = new Hono();
    app.use(
      "/login",
      rateLimit(limiter, {
        preset: "login",
        keyFrom: (c) => c.req.header("x-forwarded-for") ?? "unknown",
      }),
    );
    app.post("/login", (c) => c.json({ ok: true }));

    const res = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("RateLimit-Limit")).toBe("10");
    expect(res.headers.get("RateLimit-Remaining")).toBe("9");
    expect(res.headers.get("RateLimit-Reset")).toBe("60");
    expect(res.headers.get("Retry-After")).toBeNull();
    expect(seen).toEqual([{ key: "login:203.0.113.9", max: 10, windowMs: 60_000 }]);
  });

  it("responds 429 JSON with Retry-After when denied and does not run the handler", async () => {
    const { limiter } = fakeLimiter(() => ({
      allowed: false,
      remaining: 0,
      resetMs: 2_500,
      limit: 20,
    }));
    let handled = 0;
    const app = new Hono();
    app.use("/upload", rateLimit(limiter, { preset: RATE_LIMITS.upload, keyFrom: () => "org_1" }));
    app.post("/upload", (c) => {
      handled += 1;
      return c.text("uploaded");
    });

    const res = await app.request("/upload", { method: "POST" });

    expect(res.status).toBe(429);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: "rate_limited", retryAfterMs: 2_500 });
    expect(res.headers.get("RateLimit-Limit")).toBe("20");
    expect(res.headers.get("RateLimit-Remaining")).toBe("0");
    expect(res.headers.get("RateLimit-Reset")).toBe("3");
    expect(res.headers.get("Retry-After")).toBe("3");
    expect(handled).toBe(0);
  });

  it("namespaces the key by the preset name so scopes do not collide", async () => {
    const { seen, limiter } = fakeLimiter((input) => ({
      allowed: true,
      remaining: input.max,
      resetMs: input.windowMs,
      limit: input.max,
    }));
    const app = new Hono();
    app.use("/api/*", rateLimit(limiter, { preset: "publicApi", keyFrom: () => "tok_1" }));
    app.use("/postback", rateLimit(limiter, { preset: "postback", keyFrom: () => "org_1" }));
    app.get("/api/ping", (c) => c.text("pong"));
    app.post("/postback", (c) => c.text("ok"));

    await app.request("/api/ping");
    await app.request("/postback", { method: "POST" });

    expect(seen.map((s) => s.key)).toEqual(["publicApi:tok_1", "postback:org_1"]);
    expect(seen.map((s) => s.max)).toEqual([600, 1_000]);
  });
});
