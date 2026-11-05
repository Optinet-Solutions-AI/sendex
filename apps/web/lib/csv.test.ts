import { describe, expect, it } from "vitest";
import { csvLine } from "./csv";

describe("csvLine", () => {
  it("joins plain values with commas and CRLF", () => {
    expect(csvLine(["a", 1, true, null, undefined])).toBe("a,1,true,,\r\n");
  });

  it("quotes values with commas, quotes or newlines", () => {
    expect(csvLine(['Roy "Boy", ES', "x\ny"])).toBe('"Roy ""Boy"", ES","x\ny"\r\n');
  });

  it("writes dates as ISO strings and defuses spreadsheet formulas", () => {
    expect(csvLine([new Date("2026-09-14T10:00:00Z")])).toBe("2026-09-14T10:00:00.000Z\r\n");
    expect(csvLine(["=SUM(A1)"])).toBe("'=SUM(A1)\r\n");
  });
});
