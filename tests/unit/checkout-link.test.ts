import { describe, expect, it } from "vitest";
import { encodeCheckoutLink, parseCheckoutLink, sameBasket, withoutPaidLines } from "@/server/cart/checkout-link";
import { orderAccessToken } from "@/server/orders/access";

process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);

const REF = "TEST-MRV-7K3Q9X2M4T";
const OTHER = "TEST-MRV-ABCDEFGH12";
const line = (variantId: string, quantity: number) => ({ variantId, quantity, seenUnitPriceMinor: 100 });

describe("checkout link cookie", () => {
  it("round-trips an order reference bound to its access token", () => {
    const raw = encodeCheckoutLink(REF);
    expect(raw).toBe(`${REF}.${orderAccessToken(REF)}`);
    expect(encodeURIComponent(raw)).toBe(raw); // survives cookie encoding unchanged
    expect(parseCheckoutLink(raw)).toBe(REF);
  });

  it("rejects forged, swapped and malformed values without throwing", () => {
    const forged = [
      `${REF}.${"A".repeat(32)}`, // made-up token
      `${REF}.${orderAccessToken(OTHER)}`, // another order's token
      `${OTHER}.${orderAccessToken(REF)}`,
      `mrv-7k3q9x2m4t.${orderAccessToken("mrv-7k3q9x2m4t")}`, // not a valid reference
      `${REF}.${orderAccessToken(REF)}.extra`,
      `${REF}`,
      `.${orderAccessToken(REF)}`,
      "",
      "%E0%A4%A",
      `${REF}.${"A".repeat(200)}`,
    ];
    for (const raw of forged) {
      expect(() => parseCheckoutLink(raw)).not.toThrow();
      expect(parseCheckoutLink(raw)).toBeNull();
    }
    expect(parseCheckoutLink(undefined)).toBeNull();
  });

  it("depends on the server secret", () => {
    const raw = encodeCheckoutLink(REF);
    const original = process.env.BETTER_AUTH_SECRET;
    process.env.BETTER_AUTH_SECRET = "y".repeat(40);
    try {
      expect(parseCheckoutLink(raw)).toBeNull();
    } finally {
      process.env.BETTER_AUTH_SECRET = original;
    }
  });
});

describe("basket comparison", () => {
  it("matches the same variants and quantities in any order", () => {
    expect(sameBasket([{ variantId: "a", quantity: 2 }, { variantId: "b", quantity: 1 }], [{ variantId: "b", quantity: 1 }, { variantId: "a", quantity: 2 }])).toBe(true);
  });

  it("differs on any quantity, extra or missing line", () => {
    const base = [{ variantId: "a", quantity: 2 }];
    expect(sameBasket(base, [{ variantId: "a", quantity: 3 }])).toBe(false);
    expect(sameBasket(base, [...base, { variantId: "b", quantity: 1 }])).toBe(false);
    expect(sameBasket(base, [])).toBe(false);
    expect(sameBasket([{ variantId: "a", quantity: 1 }, { variantId: "a", quantity: 1 }], [{ variantId: "a", quantity: 1 }, { variantId: "b", quantity: 1 }])).toBe(false);
  });
});

describe("removing paid lines", () => {
  const paid = [{ variantId: "white", quantity: 2 }, { variantId: "skirt", quantity: 1 }];

  it("removes only lines with the same variant and quantity as the order", () => {
    expect(withoutPaidLines([line("white", 2), line("skirt", 1)], paid)).toEqual([]);
  });

  it("keeps lines added or changed after checkout started", () => {
    expect(withoutPaidLines([line("white", 2), line("skirt", 2), line("black", 1)], paid)).toEqual([line("skirt", 2), line("black", 1)]);
    expect(withoutPaidLines([line("white", 1)], paid)).toEqual([line("white", 1)]);
  });

  it("changes nothing for an unrelated bag, and is idempotent", () => {
    const bag = [line("black", 1)];
    expect(withoutPaidLines(bag, paid)).toEqual(bag);
    const once = withoutPaidLines([line("white", 2), line("black", 1)], paid);
    expect(withoutPaidLines(once, paid)).toEqual(once);
  });
});
