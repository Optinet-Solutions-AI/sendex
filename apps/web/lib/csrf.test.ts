import { describe, expect, it } from "vitest";
import { assertSameOrigin, CsrfError, isSameOrigin } from "./csrf";

function request(
  method: string,
  headers: Record<string, string>,
  url = "https://app.sendex.io/api/thing",
) {
  return new Request(url, { method, headers });
}

describe("assertSameOrigin", () => {
  it("lets safe methods through whatever the origin is", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(() =>
        assertSameOrigin(
          request(method, { host: "app.sendex.io", origin: "https://evil.example" }),
        ),
      ).not.toThrow();
    }
  });

  it("accepts a POST whose Origin matches the Host", () => {
    expect(() =>
      assertSameOrigin(request("POST", { host: "app.sendex.io", origin: "https://app.sendex.io" })),
    ).not.toThrow();
  });

  it("prefers X-Forwarded-Host behind the Vercel proxy", () => {
    const req = request("POST", {
      host: "internal:3000",
      "x-forwarded-host": "app.sendex.io",
      origin: "https://app.sendex.io",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("falls back to the Referer when the browser sends no Origin", () => {
    const req = request("POST", {
      host: "app.sendex.io",
      referer: "https://app.sendex.io/lists?x=1",
    });
    expect(() => assertSameOrigin(req)).not.toThrow();
  });

  it("rejects a cross-site POST with a 403 CsrfError", () => {
    const req = request("POST", { host: "app.sendex.io", origin: "https://evil.example" });
    expect(() => assertSameOrigin(req)).toThrow(CsrfError);
    try {
      assertSameOrigin(req);
    } catch (error) {
      if (!(error instanceof CsrfError)) throw error;
      expect(error.status).toBe(403);
      expect(error.code).toBe("cross_origin");
    }
  });

  it("rejects an unsafe request that carries neither Origin nor Referer", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(() => assertSameOrigin(request(method, { host: "app.sendex.io" }))).toThrow(CsrfError);
    }
  });

  it("rejects a malformed Origin and a port mismatch", () => {
    expect(() =>
      assertSameOrigin(request("POST", { host: "app.sendex.io", origin: "not a url" })),
    ).toThrow(CsrfError);
    expect(() =>
      assertSameOrigin(
        request("POST", { host: "localhost:3000", origin: "http://localhost:3001" }),
      ),
    ).toThrow(CsrfError);
  });

  it("accepts an explicitly allowed extra host", () => {
    const req = request("POST", { host: "app.sendex.io", origin: "https://admin.sendex.io" });
    expect(() => assertSameOrigin(req, { allowedHosts: ["admin.sendex.io"] })).not.toThrow();
  });
});

describe("isSameOrigin", () => {
  it("is the boolean form of the same check", () => {
    expect(isSameOrigin(request("POST", { host: "a.test", origin: "https://a.test" }))).toBe(true);
    expect(isSameOrigin(request("POST", { host: "a.test", origin: "https://b.test" }))).toBe(false);
  });
});
