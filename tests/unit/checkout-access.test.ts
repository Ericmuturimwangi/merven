import { describe, expect, it } from "vitest";
import { newOrderReference, newPaymentReference, ORDER_REFERENCE_PATTERN, orderAccessToken, verifyOrderAccess } from "@/server/orders/access";
import { checkoutInputSchema, normaliseKenyanPhone, parseBasketParam } from "@/server/orders/checkout-input";
import { configuredMailer, maskEmail } from "@/server/notifications/mailer";

const SECRET = "s".repeat(64);

describe("order references", () => {
  it("are random, non-sequential and clearly marked in test mode", () => {
    const refs = new Set(Array.from({ length: 2000 }, () => newOrderReference(false)));
    expect(refs.size).toBe(2000);
    for (const r of refs) expect(r).toMatch(ORDER_REFERENCE_PATTERN);
    expect(newOrderReference(true)).toMatch(/^TEST-MRV-[0-9A-Z]{10}$/);
  });
  it("produce Paystack-safe payment references (only A-Z, 0-9 and -)", () => {
    const ref = newPaymentReference(newOrderReference(true));
    expect(ref).toMatch(/^[A-Z0-9-]+$/);
    expect(ref).not.toBe(newPaymentReference(newOrderReference(true)));
  });
});

describe("order access tokens", () => {
  const ref = "MRV-ABCDEFGHJK";
  const token = orderAccessToken(ref, SECRET);

  it("open only the order they were issued for", () => {
    expect(verifyOrderAccess(ref, token, SECRET)).toBe(true);
    expect(verifyOrderAccess("MRV-ZZZZZZZZZZ", token, SECRET)).toBe(false);
    expect(verifyOrderAccess(ref, orderAccessToken("MRV-ZZZZZZZZZZ", SECRET), SECRET)).toBe(false);
  });
  it.each([null, undefined, "", "x", token.slice(0, -1), `${token}x`, token.toUpperCase()])("reject %j", (t) => {
    expect(verifyOrderAccess(ref, t as string, SECRET)).toBe(false);
  });
  it("depend on the server secret", () => {
    expect(verifyOrderAccess(ref, token, "t".repeat(64))).toBe(false);
  });
  it("reject malformed references", () => {
    expect(verifyOrderAccess("../admin", orderAccessToken("../admin", SECRET), SECRET)).toBe(false);
  });
});

describe("checkout input", () => {
  it.each([
    ["0712345678", "+254712345678"],
    ["0712 345 678", "+254712345678"],
    ["+254 712-345-678", "+254712345678"],
    ["254112345678", "+254112345678"],
    ["712345678", "+254712345678"],
  ])("normalises %j", (raw, e164) => expect(normaliseKenyanPhone(raw)).toBe(e164));

  it.each(["", "12345", "0812345678", "+447700900123", "07123456789", "abc"])("rejects phone %j", (raw) => {
    expect(normaliseKenyanPhone(raw)).toBeNull();
  });

  const valid = { name: "Amina Otieno", email: "amina@example.com", phone: "0712345678", items: [{ variantId: "abc123", quantity: 1 }], expectedTotalMinor: "380000" };
  it.each([
    ["name", " "],
    ["email", "not-an-email"],
    ["email", "a@b"],
    ["phone", "12"],
    ["expectedTotalMinor", "-1"],
    ["expectedTotalMinor", "12.5"],
  ])("rejects malformed %s %j", (field, value) => {
    expect(checkoutInputSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });
  it.each([0, 6, 1.5, -1])("rejects quantity %j", (quantity) => {
    expect(checkoutInputSchema.safeParse({ ...valid, items: [{ variantId: "abc123", quantity }] }).success).toBe(false);
  });
  it("rejects an empty basket or too many lines", () => {
    expect(checkoutInputSchema.safeParse({ ...valid, items: [] }).success).toBe(false);
    expect(checkoutInputSchema.safeParse({ ...valid, items: Array.from({ length: 11 }, (_, i) => ({ variantId: `v${i}`, quantity: 1 })) }).success).toBe(false);
  });
  it("parses basket URLs defensively", () => {
    expect(parseBasketParam("abc:2,abc:1,bad id:1,def:x,ghi")).toEqual([
      { variantId: "abc", quantity: 3 },
      { variantId: "ghi", quantity: 1 },
    ]);
    expect(parseBasketParam("abc:99")).toEqual([]);
    expect(parseBasketParam(undefined)).toEqual([]);
  });
});

describe("email configuration", () => {
  it("is disabled unless explicitly and fully configured", () => {
    expect(configuredMailer({})).toBeNull();
    expect(configuredMailer({ EMAIL_PROVIDER: "resend" })).toBeNull();
    expect(configuredMailer({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" })).toBeNull();
    expect(configuredMailer({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "nope", EMAIL_FROM: "a@b.c" })).toBeNull();
    expect(configuredMailer({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_abc", EMAIL_FROM: "Merven <r@merven.example>" })?.name).toBe("resend");
  });
  it("never uses the log mailer in production", () => {
    expect(configuredMailer({ EMAIL_PROVIDER: "log" })?.name).toBe("log");
    expect(configuredMailer({ EMAIL_PROVIDER: "log", VERCEL_ENV: "production" })).toBeNull();
  });
  it("masks addresses in logs", () => {
    expect(maskEmail("amina@example.com")).toBe("a***@example.com");
  });
});
