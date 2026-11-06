import { describe, expect, it } from "vitest";
import { workerPublicUrl } from "./worker-public-url";

describe("workerPublicUrl", () => {
  it("uses WORKER_PUBLIC_URL without a trailing slash", () => {
    expect(workerPublicUrl({ WORKER_PUBLIC_URL: "https://worker.example.com/" })).toBe(
      "https://worker.example.com",
    );
  });

  it("defaults to the local worker outside production", () => {
    expect(workerPublicUrl({ NODE_ENV: "development" })).toBe("http://localhost:4000");
    expect(workerPublicUrl({ NODE_ENV: "test", WORKER_PUBLIC_URL: "  " })).toBe(
      "http://localhost:4000",
    );
  });

  it("is null in production until the worker is deployed", () => {
    expect(workerPublicUrl({ NODE_ENV: "production" })).toBeNull();
    expect(workerPublicUrl({ NODE_ENV: "production", WORKER_PUBLIC_URL: "" })).toBeNull();
  });
});
