"use server";

import { safeErrorFields } from "@/lib/error-report";
import { db } from "../db";
import { basketItemSchema } from "../orders/checkout-input";
import { bagCount, withoutLine, type BagLine } from "./bag";
import { readBag, writeBag } from "./bag-store";
import { addToBag, updateBagLine, type BagChange } from "./cart-service";
import { applyPaidSettlement } from "./checkout-link-store";
import type { BagActionState } from "./state";

// Public bag actions. Server actions are reachable by anyone, so each one
// validates its input and trusts only the database for availability and price.
// They work whether or not online payment is enabled, and never create orders
// or payment attempts. Each first applies a payment the database has confirmed
// for the bag's linked order (applyPaidSettlement), so no write can bring paid
// lines back. Setting the cookie re-renders the page (Next.js).

const ERROR = "We couldn't update your bag. Please try again.";

function refusal(change: Extract<BagChange, { ok: false }>): string {
  switch (change.outcome) {
    case "not_found":
    case "unavailable":
      return "This piece is no longer available.";
    case "sold_out":
      return "This size and colour is sold out.";
    case "at_limit":
      return `You already have the most we can offer of this piece (${change.maxQuantity}).`;
    case "bag_full":
      return "Your bag is full. Remove a piece to add another.";
    case "not_in_bag":
      return "This piece isn't in your bag any more.";
  }
}

function result(change: BagChange, variantId: string, lines: BagLine[], discarded: boolean): BagActionState {
  const base = { variantId, maxQuantity: change.maxQuantity, count: bagCount(lines), ...(discarded ? { discarded } : {}) };
  if (!change.ok) return { ok: false, outcome: change.outcome, message: refusal(change), ...base };
  const message =
    change.outcome === "limited"
      ? `Only ${change.quantity} available, so your bag has ${change.quantity}.`
      : change.outcome === "added"
        ? "Added to your bag."
        : "Your bag is updated.";
  return { ok: true, outcome: change.outcome, message, quantity: change.quantity, ...base };
}

function failed(event: string, e: unknown): BagActionState {
  // No customer data in logs: the bag holds none anyway.
  console.error(JSON.stringify({ level: "error", event, ...safeErrorFields(e) }));
  return { ok: false, outcome: "error", message: ERROR };
}

const invalid: BagActionState = { ok: false, outcome: "invalid", message: "That choice isn't valid. Please choose again." };

/**
 * The bag this request carried, with a confirmed payment applied before the
 * action's own change (see applyPaidSettlement). `dirty`: it differs from the
 * cookie, so it must be written even if the change itself is refused.
 */
async function readSettledBag() {
  const bag = await readBag();
  const settlement = await applyPaidSettlement(db, bag.lines);
  return { lines: settlement.lines, discarded: bag.discarded, dirty: bag.discarded || settlement.lines.length !== bag.lines.length, finish: settlement.finish };
}

export async function addToBagAction(_prev: BagActionState, form: FormData): Promise<BagActionState> {
  const parsed = basketItemSchema.safeParse({ variantId: form.get("variantId"), quantity: form.get("quantity") ?? "1" });
  if (!parsed.success) return invalid;
  try {
    const bag = await readSettledBag();
    const change = await addToBag(db, bag.lines, parsed.data.variantId, parsed.data.quantity);
    const lines = change.ok ? change.lines : bag.lines;
    if (change.ok || bag.dirty) await writeBag(lines);
    await bag.finish();
    return result(change, parsed.data.variantId, lines, bag.discarded);
  } catch (e) {
    return failed("bag_add_failed", e);
  }
}

export async function updateBagQuantityAction(_prev: BagActionState, form: FormData): Promise<BagActionState> {
  const parsed = basketItemSchema.safeParse({ variantId: form.get("variantId"), quantity: form.get("quantity") });
  if (!parsed.success) return invalid;
  try {
    const bag = await readSettledBag();
    const change = await updateBagLine(db, bag.lines, parsed.data.variantId, parsed.data.quantity);
    const lines = change.ok ? change.lines : bag.lines;
    if (change.ok || bag.dirty) await writeBag(lines);
    await bag.finish();
    return result(change, parsed.data.variantId, lines, bag.discarded);
  } catch (e) {
    return failed("bag_update_failed", e);
  }
}

/** Removes a line without looking up its variant: works for variants that no longer exist. */
export async function removeFromBagAction(_prev: BagActionState, form: FormData): Promise<BagActionState> {
  const parsed = basketItemSchema.shape.variantId.safeParse(form.get("variantId"));
  if (!parsed.success) return invalid;
  try {
    const bag = await readSettledBag();
    const lines = withoutLine(bag.lines, parsed.data);
    await writeBag(lines);
    await bag.finish();
    return { ok: true, outcome: "removed", message: "Removed from your bag.", variantId: parsed.data, count: bagCount(lines), ...(bag.discarded ? { discarded: true } : {}) };
  } catch (e) {
    return failed("bag_remove_failed", e);
  }
}

export async function clearBagAction(): Promise<BagActionState> {
  try {
    const bag = await readSettledBag(); // a paid link is settled (and forgotten) too
    await writeBag([]);
    await bag.finish();
    return { ok: true, outcome: "cleared", message: "Your bag is empty.", count: { lines: 0, items: 0 } };
  } catch (e) {
    return failed("bag_clear_failed", e);
  }
}
