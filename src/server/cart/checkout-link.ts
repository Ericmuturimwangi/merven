import { createHmac } from "node:crypto";
import type { PaymentStatus, PrismaClient } from "@/generated/prisma/client";
import { orderAccessToken, verifyOrderAccess } from "../orders/access";
import type { BagLine } from "./bag";

// Links a bag to the order started from it, so that (1) a resubmitted bag
// checkout returns to its unpaid order instead of creating another one, and
// (2) once the database says that order is PAID, exactly the lines that were
// paid for can be removed from the bag. Buy now orders are never linked.
//
// The value is "<order reference>.<order access token>", the same HMAC token
// that guards the order page, so it can't be forged for another order. It is
// never evidence of payment: only the order's status in the database is.

export const CHECKOUT_COOKIE = "merven_checkout";
const MAX_LENGTH = 100;

export type BasketItem = { variantId: string; quantity: number };

export function encodeCheckoutLink(reference: string): string {
  return `${reference}.${orderAccessToken(reference)}`;
}

/** The linked order reference, or null for a missing, malformed or forged value. Never throws. */
export function parseCheckoutLink(raw: string | null | undefined): string | null {
  if (!raw || raw.length > MAX_LENGTH) return null;
  const parts = raw.split(".");
  if (parts.length !== 2) return null;
  try {
    return verifyOrderAccess(parts[0], parts[1]) ? parts[0] : null;
  } catch {
    return null; // e.g. the server secret is unavailable: treat as no link
  }
}

function checkoutKeySecret(): Buffer {
  const base = process.env.BETTER_AUTH_SECRET;
  if (!base || base.length < 32) throw new Error("BETTER_AUTH_SECRET is required for bag checkout keys");
  // Own label: independent of the order access-token key derived from the same secret.
  return createHmac("sha256", base).update("merven-bag-checkout-key-v1").digest();
}

/** Sorted "variantId:quantity" list: the same basket always gives the same text. */
export function canonicalBasket(items: BasketItem[]): string {
  return [...items]
    .sort((a, b) => (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0))
    .map((i) => `${i.variantId}:${i.quantity}`)
    .join(",");
}

/**
 * Idempotency key for a bag checkout: HMAC(bag session, basket, reviewed total).
 * Same browser + same basket + same total → same key → one unpaid order.
 * The total is included on purpose: the order's price is fixed at creation
 * ("the agreed price stands"), so an older unpaid order for the same basket at
 * a different price must not be handed back for a review that showed another
 * total. createOrder only accepts a total equal to the server's current price.
 */
export function bagCheckoutKey(session: string, items: BasketItem[], totalMinor: number): string {
  return createHmac("sha256", checkoutKeySecret()).update(`${session}|${canonicalBasket(items)}|${totalMinor}`).digest("hex");
}

/** Same variants in the same quantities, in any order. */
export function sameBasket(a: BasketItem[], b: BasketItem[]): boolean {
  if (a.length !== b.length) return false;
  const quantities = new Map(a.map((i) => [i.variantId, i.quantity]));
  return quantities.size === a.length && b.every((i) => quantities.get(i.variantId) === i.quantity);
}

/**
 * The bag after a paid order: a line goes only if the order holds the same
 * variant in exactly the same quantity. Lines added or changed during checkout stay.
 */
export function withoutPaidLines(lines: BagLine[], paid: BasketItem[]): BagLine[] {
  const paidQuantity = new Map(paid.map((i) => [i.variantId, i.quantity]));
  return lines.filter((l) => paidQuantity.get(l.variantId) !== l.quantity);
}

export type LinkedOrder = {
  reference: string;
  status: "PENDING_PAYMENT" | "PAID" | "CANCELLED";
  /** The agreed amount, fixed when the order was created (integer minor units, KES). */
  totalMinor: number;
  items: BasketItem[];
  payments: { status: PaymentStatus; authorizationUrl: string | null }[];
};

/** The linked order as the database has it (status, total, item snapshot, attempts), or null if it doesn't exist. */
export async function findLinkedOrder(prisma: PrismaClient, reference: string): Promise<LinkedOrder | null> {
  const order = await prisma.order.findUnique({
    where: { reference },
    select: { reference: true, status: true, totalMinor: true, items: { select: { variantId: true, quantity: true } }, payments: { select: { status: true, authorizationUrl: true } } },
  });
  return order;
}
