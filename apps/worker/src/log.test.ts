import { describe, expect, it } from "vitest";
import { createLogger, maskPhone, serialiseError } from "./log.js";

describe("createLogger", () => {
  it("writes one JSON line per call with level, msg, time and fields", () => {
    const lines: string[] = [];
    const log = createLogger({
      write: (line) => lines.push(line),
      now: () => new Date("2026-11-06T10:00:00.000Z"),
    });
    log("info", "worker listening", { port: 4000 });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual({
      level: "info",
      msg: "worker listening",
      time: "2026-11-06T10:00:00.000Z",
      port: 4000,
    });
  });

  it("serialises Error fields instead of printing {}", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) });
    log("error", "job failed", { err: new RangeError("too big") });
    const parsed = JSON.parse(lines[0] ?? "") as { err: { name: string; message: string } };
    expect(parsed.err.name).toBe("RangeError");
    expect(parsed.err.message).toBe("too big");
  });

  it("does not let fields override level or msg", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line) });
    log("warn", "real", { level: "info", msg: "fake" });
    expect(JSON.parse(lines[0] ?? "")).toMatchObject({ level: "warn", msg: "real" });
  });

  it("drops levels below the configured minimum", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (line) => lines.push(line), level: "warn" });
    log("debug", "a");
    log("info", "b");
    log("warn", "c");
    log("error", "d");
    expect(lines.map((l) => (JSON.parse(l) as { msg: string }).msg)).toEqual(["c", "d"]);
  });
});

describe("serialiseError", () => {
  it("keeps name, message and stack", () => {
    const out = serialiseError(new TypeError("nope"));
    expect(out.name).toBe("TypeError");
    expect(out.message).toBe("nope");
    expect(typeof out.stack).toBe("string");
  });
});

describe("maskPhone", () => {
  it("keeps a one-digit country code and the last two digits", () => {
    expect(maskPhone("+12025550143")).toBe("+1********43");
    expect(maskPhone("+79161234567")).toBe("+7********67");
  });

  it("keeps a two-digit country code and the last two digits", () => {
    expect(maskPhone("+34612345678")).toBe("+34*******78");
    expect(maskPhone("+447911123456")).toBe("+44********56");
    expect(maskPhone("+33612345678")).toBe("+33*******78");
  });

  it("keeps a three-digit country code and the last two digits", () => {
    expect(maskPhone("+351912345678")).toBe("+351*******78");
    expect(maskPhone("+212612345678")).toBe("+212*******78");
  });

  it("tolerates formatting characters", () => {
    expect(maskPhone("+34 612 34 56 78")).toBe("+34*******78");
  });

  it("masks everything but the last two digits when there is no country code", () => {
    expect(maskPhone("612345678")).toBe("*******78");
  });

  it("masks short or empty values completely", () => {
    expect(maskPhone("+34")).toBe("***");
    expect(maskPhone("12")).toBe("**");
    expect(maskPhone("")).toBe("");
  });
});
