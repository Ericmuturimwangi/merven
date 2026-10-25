import "server-only";
import { cookies } from "next/headers";
import type { PrismaClient } from "@/generated/prisma/client";
import type { BagLine } from "./bag";
import { readBag, writeBag } from "./bag-store";
import { checkoutKeyReleasable, priceBasket } from "../orders/order-service";
import { CHECKOUT_COOKIE, encodeCheckoutLink, findLinkedOrder, parseCheckoutLink, sameBasket, withoutPaidLines, type BasketItem, type LinkedOrder } from "./checkout-link";

// Cookie side of the bag-to-order link. Writes happen only in Server Actions
// and Route Handlers; page renders only read (checkoutLinkState).

const LINK_MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // as long as the bag itself

export async function readCheckoutLink(): Promise<{ present: boolean; reference: string | null }> {
  const raw = (await cookies()).get(CHECKOUT_COOKIE)?.value;
  return { present: raw !== undefined, reference: parseCheckoutLink(raw) };
}

export async function writeCheckoutLink(reference: string): Promise<void> {
  (await cookies()).set(CHECKOUT_COOKIE, encodeCheckoutLink(reference), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: LINK_MAX_AGE_SECONDS,
  });
}

async function clearCheckoutLink(): Promise<void> {
  (await cookies()).delete(CHECKOUT_COOKIE);
}

export type CheckoutLinkState =
  | { kind: "none" }
  /** Unusable link (malformed, forged, or the order is gone or closed): settling just removes it. */
  | { kind: "stale" }
  | { kind: "pending"; order: LinkedOrder }
  | { kind: "paid"; order: LinkedOrder };

/** Read-only view of the link, for page renders. */
export async function checkoutLinkState(prisma: PrismaClient): Promise<CheckoutLinkState> {
  const link = await readCheckoutLink();
  if (!link.present) return { kind: "none" };
  if (!link.reference) return { kind: "stale" };
  const order = await findLinkedOrder(prisma, link.reference);
  if (!order || order.status === "CANCELLED") return { kind: "stale" };
  return order.status === "PAID" ? { kind: "paid", order } : { kind: "pending", order };
}

export type BagCheckoutGuard =
  | { kind: "proceed" }
  /** The submitted basket isn't the bag as it is now (changed in another tab, or tampered with). */
  | { kind: "changed" }
  /** This bag already has an unpaid order with exactly these items: continue that one. */
  | { kind: "existing"; reference: string }
  /** The linked order is paid but the bag hasn't been settled yet. */
  | { kind: "paid" };

/**
 * Checks a bag checkout before any order is created. Read-only.
 * Submissions arriving at the same moment both see no link yet; the order's
 * checkout key (unique among unpaid orders) then keeps just one of them.
 */
export async function bagCheckoutGuard(prisma: PrismaClient, items: BasketItem[], reviewedTotalMinor: number): Promise<BagCheckoutGuard> {
  const bag = await readBag();
  if (!sameBasket(items, bag.lines)) return { kind: "changed" };
  const link = await checkoutLinkState(prisma);
  if (link.kind === "paid") return { kind: "paid" };
  const order = await resumableOrder(prisma, link, items);
  // Resumed only for a review of the current price. The reviewed total comes from
  // the browser and is never trusted: a stale one goes on to createOrder, which
  // refuses any total that isn't the server's.
  if (order && order.totalMinor === reviewedTotalMinor) return { kind: "existing", reference: order.reference };
  return { kind: "proceed" };
}

/**
 * The linked unpaid order this basket may continue, or null. One rule for the
 * checkout action, the checkout review and /bag:
 * - the same variants and quantities;
 * - its agreed total equals the basket's price as createOrder computes it now
 *   (priceBasket: server prices, integer KES minor units);
 * - it still holds this bag's checkout: an order that has used every attempt is
 *   continued too (its page asks the customer to contact the shop) unless none
 *   of its attempts could ever be paid (checkoutKeyReleasable), in which case a
 *   replacement order is offered.
 * Anything else goes through createOrder, which re-prices and, for such an
 * order, releases its checkout key.
 */
export async function resumableOrder(prisma: PrismaClient, state: CheckoutLinkState, items: BasketItem[]): Promise<LinkedOrder | null> {
  if (state.kind !== "pending" || !sameBasket(state.order.items, items) || checkoutKeyReleasable(state.order.payments)) return null;
  const { problems, subtotalMinor } = await priceBasket(prisma, items);
  return problems.length === 0 && subtotalMinor === state.order.totalMinor ? state.order : null;
}

export type Settlement =
  | { outcome: "none" | "stale" }
  | { outcome: "pending"; reference: string }
  | { outcome: "settled"; reference: string; removed: number; kept: number };

export type PaidSettlement = {
  state: CheckoutLinkState;
  /** The lines without those the linked order paid for (unchanged unless it is PAID). */
  lines: BagLine[];
  /** Call after the bag is written: forgets a settled or unusable link. */
  finish(): Promise<void>;
};

/**
 * The one settlement rule, applied to bag lines about to be written. Every bag
 * write (add, update, remove, clear, settle) goes through it, so all of them
 * converge: if the database says the linked order is PAID, its exactly matching
 * lines go before the write's own change, and the link goes after the write.
 * Pending, failed or unknown orders change nothing.
 */
export async function applyPaidSettlement(prisma: PrismaClient, lines: BagLine[]): Promise<PaidSettlement> {
  const state = await checkoutLinkState(prisma);
  const keep = async () => {};
  if (state.kind === "stale") return { state, lines, finish: clearCheckoutLink };
  if (state.kind !== "paid") return { state, lines, finish: keep };
  return { state, lines: withoutPaidLines(lines, state.order.items), finish: clearCheckoutLink };
}

/**
 * Removes the paid lines from the bag once the database says the linked order
 * is PAID, then forgets the link. Pending orders change nothing. Safe to repeat:
 * after settling there is no link left. Only for Server Actions and Route Handlers.
 *
 * Limitation of cookie storage: each response carries a whole bag computed from
 * the cookie its request carried, and the browser keeps whichever arrives last.
 * Because every bag write applies the same settlement, a late add/update can't
 * bring paid lines back; but if this settlement's response arrives after an add
 * sent at the same moment from another tab, that add is lost (never a paid line).
 */
export async function settlePaidBag(prisma: PrismaClient): Promise<Settlement> {
  const bag = await readBag();
  const settlement = await applyPaidSettlement(prisma, bag.lines);
  const { state } = settlement;
  if (state.kind === "none") return { outcome: "none" };
  if (state.kind === "pending") return { outcome: "pending", reference: state.order.reference };
  if (state.kind === "stale") {
    await settlement.finish();
    return { outcome: "stale" };
  }
  if (settlement.lines.length !== bag.lines.length || bag.discarded) await writeBag(settlement.lines);
  await settlement.finish();
  return { outcome: "settled", reference: state.order.reference, removed: bag.lines.length - settlement.lines.length, kept: settlement.lines.length };
}
