import { describe, expect, it } from "vitest";
import { formatKES, minorToInput, parseKESToMinor } from "@/lib/money";

describe("formatKES", () => {
  it("formats whole shillings without decimals", () => {
    expect(formatKES(450000)).toBe("KES 4,500");
    expect(formatKES(0)).toBe("KES 0");
    expect(formatKES(1800000)).toBe("KES 18,000");
  });
  it("shows two decimals when there are cents", () => {
    expect(formatKES(450050)).toBe("KES 4,500.50");
  });
  it("rejects non-integer minor units", () => {
    expect(() => formatKES(10.5)).toThrow();
  });
});

describe("parseKESToMinor", () => {
  it.each([
    ["4500", 450000],
    ["4,500", 450000],
    ["KES 4,500", 450000],
    ["4500.5", 450050],
    ["4500.05", 450005],
    [" 0 ", 0],
  ])("parses %j", (input, expected) => {
    expect(parseKESToMinor(input)).toBe(expected);
  });
  it.each(["", "-100", "12.345", "abc", "1e5", "4 500", "9999999999"])("rejects %j", (input) => {
    expect(parseKESToMinor(input)).toBeNull();
  });
  it("round-trips through minorToInput", () => {
    for (const v of [0, 100, 450000, 450050, 999]) expect(parseKESToMinor(minorToInput(v))).toBe(v);
  });
});
