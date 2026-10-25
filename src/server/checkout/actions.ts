"use server";

import { refresh, updateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { ensureBagSession, readBagSession } from "../cart/bag-session";
import { bagCheckoutKey } from "../cart/checkout-link";
import { bagCheckoutGuard, writeCheckoutLink } from "../cart/checkout-link-store";
import { CATALOGUE_TAG } from "../catalogue/queries";
import { db } from "../db";
import { orderStatusPath, verifyOrderAccess } from "../orders/access";
import { checkoutInputSchema, parseBasketParam } from "../orders/checkout-input";
import { createOrder, initializeAttempt, reconcileOrder, startNewAttempt } from "../orders/order-service";
import { afterPaymentChange, paymentDeps } from "../payments/runtime";
import { clientIp, rateLimit } from "../rate-limit";
import type { CheckoutState } from "./state";

// Public checkout actions. Server actions are reachable by anyone, so every one
// re-checks that payments are enabled, rate-limits, validates input and (for an
// existing order) requires the unguessable order access token.

const UNAVAILABLE = "Online payment isn't available right now. You can still order on WhatsApp.";
const BUSY = "Too many attempts. Please wait a few minutes and try again.";

async function limited(key: string, max: number, windowMs: number) {
  const ip = clientIp(await headers());
  return !(await rateLimit(db, `checkout:${key}:${ip}`, { max, windowMs })).allowed;
}

export async function startCheckoutAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const deps = await paymentDeps();
  if (!deps) return { ok: false, message: UNAVAILABLE };
  if (await limited("start", 10, 10 * 60_000)) return { ok: false, message: BUSY };

  const values = { name: String(form.get("name") ?? "").slice(0, 80), email: String(form.get("email") ?? "").slice(0, 254), phone: String(form.get("phone") ?? "").slice(0, 30) };
  const parsed = checkoutInputSchema.safeParse({
    name: form.get("name"),
    email: form.get("email"),
    phone: form.get("phone"),
    items: parseBasketParam(String(form.get("items") ?? "")),
    expectedTotalMinor: form.get("expectedTotalMinor"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Please check your details.", errors: z.flattenError(parsed.error).fieldErrors as CheckoutState["errors"], values };
  }

  // Bag checkout: the order must be the bag exactly as it is now, and a bag that
  // already has an unpaid order goes back to it instead of creating another.
  // Buy now (no source) is unchanged.
  const fromBag = form.get("source") === "bag";
  let checkoutKey: string | null = null;
  if (fromBag) {
    const guard = await bagCheckoutGuard(db, parsed.data.items, parsed.data.expectedTotalMinor);
    if (guard.kind === "existing") redirect(orderStatusPath(guard.reference));
    if (guard.kind !== "proceed") {
      return {
        ok: false,
        message: guard.kind === "paid" ? "Your earlier order from this bag has been paid. Please check your bag before ordering again." : "Your bag changed since you opened checkout. Please review it again.",
        reviewAgain: true,
        values,
      };
    }
    // Concurrent submissions (two tabs, a double send) carry no link yet; the
    // checkout key makes the database keep just one unpaid order for them. The
    // key needs a session this browser already had: one created by this request
    // could differ from one created by a simultaneous request, so a bag without
    // a session gets one and is asked to confirm again, creating nothing.
    const session = await readBagSession();
    if (!session) {
      await ensureBagSession();
      return { ok: false, message: "Please confirm your order once more.", reviewAgain: true, values };
    }
    checkoutKey = bagCheckoutKey(session, parsed.data.items, parsed.data.expectedTotalMinor);
  }

  const created = await createOrder(db, parsed.data, { testMode: deps.config.mode === "test", testDatabaseToken: deps.config.testDatabaseToken, checkoutKey });
  if (!created.ok) {
    if (created.reason === "test_database_not_approved") return { ok: false, message: UNAVAILABLE };
    if (created.reason === "duplicate") {
      // Same browser session, basket and total: this caller is continuing that checkout.
      await writeCheckoutLink(created.order.reference);
      redirect(orderStatusPath(created.order.reference));
    }
    return created.reason === "price_changed"
      ? { ok: false, message: "A price changed since you opened this page. Please review the updated total and confirm again.", reviewAgain: true, values }
      : { ok: false, message: "Some items are no longer available in the quantity you chose. Please review your order.", reviewAgain: true, values };
  }

  // Linked before Paystack is called, so a retry or resubmission finds this order.
  if (fromBag) await writeCheckoutLink(created.order.reference);
  const init = await initializeAttempt(deps, created.attempt.id);
  // Paystack's checkout page, or our own order page explaining what happened.
  redirect(init.ok ? init.authorizationUrl : orderStatusPath(created.order.reference));
}

const orderForm = z.object({ reference: z.string().max(40), token: z.string().max(64) });

async function authorisedOrder(form: FormData) {
  const parsed = orderForm.safeParse({ reference: form.get("reference"), token: form.get("token") });
  if (!parsed.success || !verifyOrderAccess(parsed.data.reference, parsed.data.token)) return null;
  return db.order.findUnique({ where: { reference: parsed.data.reference }, select: { id: true, reference: true } });
}

const RETRY_MESSAGES: Record<string, string> = {
  already_paid: "This order is already paid.",
  too_many_attempts: "This order has reached the limit of payment attempts. Please contact us on WhatsApp.",
  previous_unconfirmed: "We're still confirming your previous payment attempt with Paystack. Please check again in a minute before paying again.",
  unavailable: "An item in this order is no longer available. Please contact us on WhatsApp.",
  not_payable: "This order can't be paid online.",
  provider_rejected: "Paystack couldn't start the payment. Please try again later.",
  outcome_unknown: "We couldn't reach Paystack. Please check again in a minute before paying again.",
};

export async function retryPaymentAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const deps = await paymentDeps();
  if (!deps) return { ok: false, message: UNAVAILABLE };
  const order = await authorisedOrder(form);
  if (!order) return { ok: false, message: "This order link isn't valid." };
  if (await limited(`retry:${order.reference}`, 5, 10 * 60_000)) return { ok: false, message: BUSY };

  const res = await startNewAttempt(deps, order.id);
  if (res.stockChanged) {
    updateTag(CATALOGUE_TAG);
    after(() => afterPaymentChange({ stockChanged: false, receiptQueued: true, orderId: order.id }, { revalidate: false }));
  }
  if (res.ok) redirect(res.authorizationUrl);
  refresh();
  return { ok: res.reason === "already_paid", message: RETRY_MESSAGES[res.reason] };
}

export async function checkPaymentAction(_prev: CheckoutState, form: FormData): Promise<CheckoutState> {
  const deps = await paymentDeps();
  if (!deps) return { ok: false, message: UNAVAILABLE };
  const order = await authorisedOrder(form);
  if (!order) return { ok: false, message: "This order link isn't valid." };
  if (await limited(`check:${order.reference}`, 10, 5 * 60_000)) return { ok: false, message: BUSY };

  // Also re-checks abandoned or failed attempts that reached Paystack (at most 5 per order): "I paid" is worth checking.
  const res = await reconcileOrder(deps, order.id, { scope: "recoverable" });
  if (res.stockChanged) updateTag(CATALOGUE_TAG);
  if (res.receiptQueued) after(() => afterPaymentChange({ stockChanged: false, receiptQueued: true, orderId: order.id }, { revalidate: false }));
  refresh();
  if (res.paid) return { ok: true, message: "Payment confirmed." };
  if (res.unverified > 0) return { ok: false, message: "We couldn't reach Paystack just now. Please try again in a minute." };
  return { ok: true, message: "Status updated." };
}
