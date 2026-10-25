import { describe, expect, it } from "vitest";
import { BAG_VERSION, bagCount, MAX_BAG_COOKIE_LENGTH, MAX_BAG_LINES, parseBag, serializeBag, withLine, withoutLine, type BagLine } from "@/server/cart/bag";
import { MAX_LINES, MAX_QUANTITY_PER_LINE } from "@/server/orders/checkout-input";

const id = (n: number) => `cmvariant${String(n).padStart(4, "0")}`;
const line = (n: number, quantity = 1, seenUnitPriceMinor: number | null = 380000): BagLine => ({ variantId: id(n), quantity, seenUnitPriceMinor });

describe("bag cookie format", () => {
  it("round-trips lines, with and without a seen price", () => {
    const lines = [line(1, 2), line(2, 1, null)];
    const raw = serializeBag(lines);
    expect(raw).toBe(`v1.${id(1)}_2_380000.${id(2)}_1`);
    expect(parseBag(raw)).toEqual({ lines, discarded: false });
  });

  it("uses only characters that cookie encoding leaves unchanged", () => {
    const raw = serializeBag([line(1, 5, 999999999), line(2)]);
    expect(encodeURIComponent(raw)).toBe(raw);
  });

  it("treats a missing or empty cookie as an empty bag", () => {
    for (const raw of [undefined, null, "", BAG_VERSION]) expect(parseBag(raw)).toEqual({ lines: [], discarded: false });
  });

  it("uses the same limits as checkout", () => {
    expect(MAX_BAG_LINES).toBe(MAX_LINES);
    expect(MAX_BAG_LINES).toBe(10);
    expect(MAX_QUANTITY_PER_LINE).toBe(5);
  });

  it("fits the largest valid bag within the length limit", () => {
    const longest = Array.from({ length: MAX_BAG_LINES }, (_, i) => ({ variantId: `${"a".repeat(60)}${String(i).padStart(4, "0")}`, quantity: 5, seenUnitPriceMinor: 999999999 }));
    const raw = serializeBag(longest);
    expect(raw.length).toBeLessThan(MAX_BAG_COOKIE_LENGTH);
    expect(parseBag(raw).lines).toHaveLength(MAX_BAG_LINES);
  });
});

describe("parsing untrusted bag cookies", () => {
  it("discards unknown or missing versions entirely", () => {
    for (const raw of [`v2.${id(1)}_1`, `${id(1)}_1`, `V1.${id(1)}_1`, `.${id(1)}_1`, "garbage"]) {
      expect(parseBag(raw)).toEqual({ lines: [], discarded: true });
    }
  });

  it("discards an oversized value entirely, without parsing it", () => {
    const raw = `v1.${id(1)}_1.${"x".repeat(MAX_BAG_COOKIE_LENGTH)}`;
    expect(parseBag(raw)).toEqual({ lines: [], discarded: true });
  });

  it("drops malformed lines but keeps the valid ones", () => {
    const bad = [
      "",
      "CMUPPER_1", // ids are lowercase
      "cm-dash_1",
      "cm space_1",
      `${"a".repeat(65)}_1`, // id too long
      `${id(3)}`, // no quantity
      `${id(3)}_`,
      `${id(3)}_0`,
      `${id(3)}_6`, // above the per-line limit
      `${id(3)}_-1`,
      `${id(3)}_abc`,
      `${id(3)}_1_-5`,
      `${id(3)}_1_1e3`,
      `${id(3)}_1_2_3`,
      `${id(3)}_1_${"9".repeat(10)}`, // seen price too long
    ];
    const parsed = parseBag(["v1", `${id(1)}_2`, ...bad, `${id(2)}_1_420000`].join("."));
    expect(parsed.discarded).toBe(true);
    expect(parsed.lines).toEqual([line(1, 2, null), line(2, 1, 420000)]);
  });

  it("handles a truncated value without throwing", () => {
    const raw = serializeBag([line(1, 2), line(2, 3)]);
    for (let n = 0; n <= raw.length; n++) {
      const parsed = parseBag(raw.slice(0, n));
      expect(parsed.lines.length).toBeLessThanOrEqual(2);
      for (const l of parsed.lines) expect(l.quantity).toBeGreaterThanOrEqual(1);
    }
  });

  it("merges duplicate variants, capped at the per-line limit", () => {
    expect(parseBag(`v1.${id(1)}_2_100.${id(1)}_2_200`).lines).toEqual([line(1, 4, 100)]);
    expect(parseBag(`v1.${id(1)}_4.${id(1)}_4`).lines).toEqual([line(1, 5, null)]);
  });

  it("keeps at most 10 distinct lines", () => {
    const raw = serializeBag(Array.from({ length: 12 }, (_, i) => line(i)));
    const parsed = parseBag(raw);
    expect(parsed.discarded).toBe(true);
    expect(parsed.lines.map((l) => l.variantId)).toEqual(Array.from({ length: 10 }, (_, i) => id(i)));
  });

  it("never throws, whatever the input", () => {
    for (const raw of ["%E0%A4%A", "v1.%00_1", "v1." + "._".repeat(400), "v1.\u0000‮_1", "v1..", "v1.__"]) {
      expect(() => parseBag(raw)).not.toThrow();
      expect(parseBag(raw).lines).toEqual([]);
    }
  });
});

describe("bag helpers", () => {
  it("replaces an existing line instead of duplicating it", () => {
    expect(withLine([line(1), line(2)], line(1, 3))).toEqual([line(1, 3), line(2)]);
    expect(withLine([line(1)], line(2))).toEqual([line(1), line(2)]);
  });

  it("removes a line, and ignores one that isn't there", () => {
    expect(withoutLine([line(1), line(2)], id(1))).toEqual([line(2)]);
    expect(withoutLine([line(1)], id(9))).toEqual([line(1)]);
  });

  it("counts lines and units", () => {
    expect(bagCount([line(1, 2), line(2, 3)])).toEqual({ lines: 2, items: 5 });
    expect(bagCount([])).toEqual({ lines: 0, items: 0 });
  });
});
