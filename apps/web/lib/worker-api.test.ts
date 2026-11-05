import { describe, expect, it } from "vitest";
import {
  clearEmergencyStopFlag,
  raiseEmergencyStop,
  readEmergencyStop,
  type WorkerApiConfig,
  WorkerApiError,
  workerApiConfig,
} from "./worker-api";

type Call = { url: string; init: RequestInit | undefined };

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { calls, fetchImpl };
}

function config(fetchImpl: typeof fetch, secret: string | null = "s3cret"): WorkerApiConfig {
  return { baseUrl: "http://worker.test", secret, fetchImpl, timeoutMs: 1000 };
}

describe("workerApiConfig", () => {
  it("prefers WORKER_INTERNAL_URL, then WORKER_PUBLIC_URL, then localhost, without a trailing slash", () => {
    expect(
      workerApiConfig({ WORKER_INTERNAL_URL: "http://a/", WORKER_PUBLIC_URL: "http://b" }),
    ).toMatchObject({
      baseUrl: "http://a",
      secret: null,
    });
    expect(workerApiConfig({ WORKER_PUBLIC_URL: "http://b/" }).baseUrl).toBe("http://b");
    expect(workerApiConfig({}).baseUrl).toBe("http://localhost:4000");
    expect(workerApiConfig({ INTERNAL_API_SECRET: " x " }).secret).toBe("x");
    expect(workerApiConfig({ INTERNAL_API_SECRET: "  " }).secret).toBeNull();
  });
});

describe("emergency stop calls", () => {
  it("reads the state with the secret header", async () => {
    const { calls, fetchImpl } = fakeFetch(200, { stopped: false, stop: null });
    expect(await readEmergencyStop("org-1", config(fetchImpl))).toEqual({
      stopped: false,
      stop: null,
    });
    expect(calls[0]?.url).toBe("http://worker.test/internal/emergency-stop?organisationId=org-1");
    expect(new Headers(calls[0]?.init?.headers).get("x-internal-secret")).toBe("s3cret");
    expect(calls[0]?.init?.method ?? "GET").toBe("GET");
  });

  it("raises and clears the flag, parsing the worker's answer", async () => {
    const stop = { reason: "bad link", byUserId: "u-1", stoppedAt: "2026-11-06T10:00:00.000Z" };
    const raised = fakeFetch(200, { stopped: true, stop });
    expect(
      await raiseEmergencyStop(
        "org-1",
        { reason: "bad link", byUserId: "u-1" },
        config(raised.fetchImpl),
      ),
    ).toEqual({ stopped: true, stop });
    expect(raised.calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(raised.calls[0]?.init?.body))).toEqual({
      organisationId: "org-1",
      reason: "bad link",
      byUserId: "u-1",
    });

    const cleared = fakeFetch(200, { stopped: false, stop: null, cleared: true });
    expect(await clearEmergencyStopFlag("org-1", config(cleared.fetchImpl))).toEqual({
      stopped: false,
      stop: null,
    });
    expect(cleared.calls[0]?.init?.method).toBe("DELETE");
    expect(cleared.calls[0]?.url).toBe(
      "http://worker.test/internal/emergency-stop?organisationId=org-1",
    );
  });

  it("turns a non-2xx answer into a WorkerApiError carrying the worker's message", async () => {
    const { fetchImpl } = fakeFetch(503, { error: "emergency stop unavailable: no Redis" });
    await expect(readEmergencyStop("org-1", config(fetchImpl))).rejects.toMatchObject({
      name: "WorkerApiError",
      status: 503,
      message: "emergency stop unavailable: no Redis",
    });
  });

  it("refuses to call the worker without a secret and rejects a malformed answer", async () => {
    const { calls, fetchImpl } = fakeFetch(200, { stopped: true, stop: null });
    await expect(readEmergencyStop("org-1", config(fetchImpl, null))).rejects.toBeInstanceOf(
      WorkerApiError,
    );
    expect(calls).toHaveLength(0);
    await expect(readEmergencyStop("org-1", config(fetchImpl))).rejects.toThrow(/unexpected/);
  });
});
