import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// Public identifiers for orders. References are random (not sequential) and
// test-mode orders are visibly prefixed so they can never pass for real ones.
// Access to an order page needs a token: an HMAC of the reference keyed with a
// server secret, so links can be regenerated (e.g. for the receipt email)
// without storing a token. Rotating BETTER_AUTH_SECRET invalidates old links.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32: no I, L, O, U

function randomCode(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] & 31];
  return out;
}

export function newOrderReference(testMode: boolean): string {
  return `${testMode ? "TEST-" : ""}MRV-${randomCode(10)}`; // 50 bits of randomness
}

/** Paystack transaction reference for one payment attempt: unique, and only [A-Z0-9-]. */
export function newPaymentReference(orderReference: string): string {
  return `${orderReference}-P${randomCode(8)}`;
}

export const ORDER_REFERENCE_PATTERN = /^(TEST-)?MRV-[0-9A-HJKMNP-TV-Z]{10}$/;

function accessSecret(): string {
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("BETTER_AUTH_SECRET is required for order links");
  return createHmac("sha256", base).update("merven-order-access-v1").digest("hex");
}

export function orderAccessToken(reference: string, secret = accessSecret()): string {
  return createHmac("sha256", secret).update(`order:${reference}`).digest("base64url").slice(0, 32);
}

export function verifyOrderAccess(reference: string, token: string | null | undefined, secret = accessSecret()): boolean {
  if (!token || !ORDER_REFERENCE_PATTERN.test(reference)) return false;
  const expected = Buffer.from(orderAccessToken(reference, secret));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function orderStatusPath(reference: string): string {
  return `/checkout/order/${reference}?token=${orderAccessToken(reference)}`;
}
