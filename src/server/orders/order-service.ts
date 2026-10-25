import { Prisma, type PaymentStatus, type PrismaClient } from "@/generated/prisma/client";
import type { PaymentConfig } from "../payments/config";
import { PaystackError, type PaystackClient, type PaystackTransaction } from "../payments/paystack";
import { databaseApprovedFor } from "../payments/test-database";
import { newOrderReference, newPaymentReference } from "./access";
import { ALERT_KINDS, queueOwnerAlert } from "../notifications/owner-alerts";
import { MAX_QUANTITY_PER_LINE, type CheckoutInput } from "./checkout-input";

// Orders and payment attempts. Rules:
// - Prices, availability and totals always come from the database.
// - An order becomes PAID only through applyVerification(), i.e. after Paystack's
//   verify endpoint confirms success with the expected reference, amount,
//   currency and environment. Redirects, webhooks and init responses never do.
// - Every state change happens under a row lock on the order, so duplicate and
//   concurrent webhooks/callbacks apply at most once.
// - Stock is not reserved at checkout; it is deducted once, when payment is
//   confirmed. An oversell is flagged for the owner, never auto-refunded.
// - Test-mode orders and payments only touch a database approved for test
//   writes (marker check), checked again inside the locked transaction.

export type EnabledPaymentConfig = Extract<PaymentConfig, { enabled: true }>;
export type PaymentDeps = { prisma: PrismaClient; paystack: PaystackClient; config: EnabledPaymentConfig };

export const MAX_ATTEMPTS_PER_ORDER = 5;
const REUSE_PENDING_ATTEMPT_MS = 30 * 60_000;

/**
 * An unpaid order can no longer be paid online: every attempt has been used and
 * none is open, unconfirmed or successful (a SUCCESS on an unpaid order is for
 * the owner to review, never to work around).
 */
export function attemptsExhausted(payments: { status: PaymentStatus }[]): boolean {
  return payments.length >= MAX_ATTEMPTS_PER_ORDER && !payments.some((p) => p.status === "INITIALIZING" || p.status === "PENDING" || p.status === "SUCCESS");
}

/**
 * Whether an attempt might still be paid. Paystack's statuses are recorded as
 * reported, but whether a transaction reported "abandoned" or "failed" can
 * still be completed later is NOT confirmed with Paystack, so any attempt that
 * reached a Paystack checkout page (has an authorization URL) counts as
 * possibly payable. Only two outcomes are treated as final:
 * - REVERSED (it was paid and then reversed);
 * - FAILED without an authorization URL: Paystack refused to start it, or
 *   reported the transaction doesn't exist, so no page was ever shown.
 */
export function attemptMayStillSucceed(p: { status: PaymentStatus; authorizationUrl: string | null }): boolean {
  if (p.status === "REVERSED") return false;
  if (p.status === "FAILED" && !p.authorizationUrl) return false;
  return true;
}

/**
 * An exhausted order's bag-checkout key may be handed to a replacement order
 * only when none of its attempts could still be paid: otherwise a late payment
 * on the old order could sit alongside a paid replacement.
 */
export function checkoutKeyReleasable(payments: { status: PaymentStatus; authorizationUrl: string | null }[]): boolean {
  return attemptsExhausted(payments) && !payments.some(attemptMayStillSucceed);
}
const INIT_GRACE_MS = 2 * 60_000;
const RECEIPT = "PAYMENT_RECEIPT";

// --- Pricing ---------------------------------------------------------------------

export type PricedLine = {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  sku: string;
  size: string;
  colour: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
  image: { url: string; alt: string; width: number; height: number } | null;
};

export type BasketProblem = {
  variantId: string;
  productName: string | null;
  kind: "unavailable" | "sold_out" | "insufficient_stock" | "quantity_limit";
  available?: number;
};

/** Prices a basket from the database. Only published products and active variants are sellable. */
export async function priceBasket(prisma: PrismaClient | Prisma.TransactionClient, items: { variantId: string; quantity: number }[]) {
  const merged = new Map<string, number>();
  for (const i of items) merged.set(i.variantId, (merged.get(i.variantId) ?? 0) + i.quantity);

  const variants = await prisma.productVariant.findMany({
    where: { id: { in: [...merged.keys()] } },
    select: {
      id: true,
      sku: true,
      size: true,
      colour: true,
      stock: true,
      active: true,
      priceMinor: true,
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          priceMinor: true,
          images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 1, select: { url: true, alt: true, width: true, height: true } },
        },
      },
    },
  });
  const byId = new Map(variants.map((v) => [v.id, v]));

  const lines: PricedLine[] = [];
  const problems: BasketProblem[] = [];
  for (const [variantId, quantity] of merged) {
    const v = byId.get(variantId);
    if (!v || !v.active || v.product.status !== "PUBLISHED") {
      problems.push({ variantId, productName: v?.product.name ?? null, kind: "unavailable" });
      continue;
    }
    if (quantity > MAX_QUANTITY_PER_LINE) problems.push({ variantId, productName: v.product.name, kind: "quantity_limit" });
    else if (v.stock <= 0) problems.push({ variantId, productName: v.product.name, kind: "sold_out" });
    else if (quantity > v.stock) problems.push({ variantId, productName: v.product.name, kind: "insufficient_stock", available: v.stock });
    const unit = v.priceMinor ?? v.product.priceMinor;
    lines.push({
      variantId,
      productId: v.product.id,
      productName: v.product.name,
      productSlug: v.product.slug,
      sku: v.sku,
      size: v.size,
      colour: v.colour,
      unitPriceMinor: unit,
      quantity,
      lineTotalMinor: unit * quantity,
      image: v.product.images[0] ?? null,
    });
  }
  const subtotalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
  return { lines, problems, subtotalMinor };
}

// --- Order creation -------------------------------------------------------------

export type CreateOrderResult =
  | { ok: true; order: { id: string; reference: string }; attempt: { id: string; reference: string } }
  | { ok: false; reason: "unavailable"; problems: BasketProblem[] }
  | { ok: false; reason: "price_changed"; subtotalMinor: number }
  | { ok: false; reason: "test_database_not_approved" }
  /** A bag checkout with this checkout key already has an unpaid order: continue that one. */
  | { ok: false; reason: "duplicate"; order: { id: string; reference: string } };

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

type KeyClaim =
  /** An unpaid order that can still be paid holds the key: the caller continues it. */
  | { kind: "held"; order: { id: string; reference: string } }
  /** No unpaid order holds the key any more (released here or by a concurrent request): try again. */
  | { kind: "free" };

/**
 * Who holds a checkout key after a unique-index conflict. The holder keeps it
 * while any of its attempts could still be paid, even if it has used every
 * attempt: the customer is sent to that order (which asks them to contact the
 * shop) rather than to a replacement that could be paid as well. Only a holder
 * whose attempts all provably failed gives the key up (checkoutKeyReleasable);
 * the order itself is untouched apart from a note for the owner. If a
 * concurrent request released it first (the conditional update matches
 * nothing), the key is just as free: the caller re-tries rather than returning
 * that old order.
 */
async function claimOf(prisma: PrismaClient, checkoutKey: string): Promise<KeyClaim> {
  const holder = await prisma.order.findFirst({
    where: { checkoutKey, status: "PENDING_PAYMENT" },
    select: { id: true, reference: true, needsAttention: true, payments: { select: { status: true, authorizationUrl: true } } },
  });
  if (!holder) return { kind: "free" };
  if (!checkoutKeyReleasable(holder.payments)) return { kind: "held", order: { id: holder.id, reference: holder.reference } };
  const released = await prisma.order.updateMany({
    where: { id: holder.id, status: "PENDING_PAYMENT", checkoutKey },
    data: { checkoutKey: null, needsAttention: note(holder.needsAttention, "Payment attempt limit reached and no attempt ever reached Paystack; the customer has since started a new order for the same bag") },
  });
  if (released.count === 1) log("checkout_key_released", { order: holder.reference });
  return { kind: "free" };
}

const MAX_INSERT_TRIES = 3;

export async function createOrder(
  prisma: PrismaClient,
  input: CheckoutInput,
  opts: { testMode: boolean; testDatabaseToken?: string | null; checkoutKey?: string | null },
): Promise<CreateOrderResult> {
  // Test and live modes are both implemented; which one applies comes from the
  // payment configuration (see ../payments/config.ts: live only on the Vercel
  // production deployment). The database must suit the mode: a test order needs
  // the test-marked database, a live order a database without that marker
  // (databaseApprovedFor).
  if (!(await databaseApprovedFor(prisma, opts.testMode ? "test" : "live", opts.testDatabaseToken))) {
    return { ok: false, reason: "test_database_not_approved" };
  }
  const { lines, problems, subtotalMinor } = await priceBasket(prisma, input.items);
  if (problems.length > 0 || lines.length === 0) return { ok: false, reason: "unavailable", problems };
  // The customer must pay exactly what they reviewed; any difference sends them back.
  if (subtotalMinor !== input.expectedTotalMinor) return { ok: false, reason: "price_changed", subtotalMinor };

  // A bag checkout carries a checkout key: the partial unique index lets only one
  // unpaid order hold it, so concurrent submissions of the same bag converge here.
  // The losing request creates nothing (order, items and attempt are one write).
  // A conflict whose holder is gone (paid, released) is re-tried a bounded number
  // of times; anything else is re-thrown, never turned into a "duplicate".
  for (let tries = 1; ; tries++) {
    try {
      return await insertOrder(prisma, input, lines, subtotalMinor, opts);
    } catch (e) {
      if (!opts.checkoutKey || !isUniqueViolation(e)) throw e;
      const claim = await claimOf(prisma, opts.checkoutKey);
      if (claim.kind === "held") return { ok: false, reason: "duplicate", order: claim.order };
      if (tries >= MAX_INSERT_TRIES) throw e;
    }
  }
}

async function insertOrder(
  prisma: PrismaClient,
  input: CheckoutInput,
  lines: PricedLine[],
  subtotalMinor: number,
  opts: { testMode: boolean; checkoutKey?: string | null },
): Promise<CreateOrderResult> {
  const reference = newOrderReference(opts.testMode);
  const order = await prisma.order.create({
    data: {
      reference,
      testMode: opts.testMode,
      checkoutKey: opts.checkoutKey ?? null,
      customerName: input.name,
      customerEmail: input.email,
      customerPhone: input.phone,
      currency: "KES",
      subtotalMinor,
      totalMinor: subtotalMinor, // delivery is arranged separately and not charged online
      items: {
        create: lines.map((l) => ({
          variantId: l.variantId,
          productId: l.productId,
          productName: l.productName,
          productSlug: l.productSlug,
          sku: l.sku,
          size: l.size,
          colour: l.colour,
          unitPriceMinor: l.unitPriceMinor,
          quantity: l.quantity,
          lineTotalMinor: l.lineTotalMinor,
        })),
      },
      // The attempt (and its reference) is persisted before Paystack is called.
      payments: { create: { reference: newPaymentReference(reference), testMode: opts.testMode, amountMinor: subtotalMinor, currency: "KES" } },
    },
    select: { id: true, reference: true, payments: { select: { id: true, reference: true } } },
  });
  return { ok: true, order: { id: order.id, reference: order.reference }, attempt: order.payments[0] };
}

// --- Payment initialisation ------------------------------------------------------

export type InitializeResult =
  | { ok: true; authorizationUrl: string }
  | { ok: false; reason: "provider_rejected" | "outcome_unknown" | "not_initializable" | "test_database_not_approved" };

export async function initializeAttempt(deps: PaymentDeps, attemptId: string): Promise<InitializeResult> {
  const attempt = await deps.prisma.paymentAttempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { order: { select: { reference: true, customerEmail: true, status: true } } },
  });
  if (attempt.status !== "INITIALIZING" || attempt.order.status !== "PENDING_PAYMENT") return { ok: false, reason: "not_initializable" };
  // A test attempt is only ever sent with test credentials, a live one with live credentials.
  if (attempt.testMode !== (deps.config.mode === "test")) return { ok: false, reason: "not_initializable" };
  if (!(await databaseApprovedFor(deps.prisma, deps.config.mode, deps.config.testDatabaseToken))) {
    return { ok: false, reason: "test_database_not_approved" };
  }
  try {
    const res = await deps.paystack.initialize({
      email: attempt.order.customerEmail,
      amountMinor: attempt.amountMinor,
      currency: "KES",
      reference: attempt.reference,
      callbackUrl: deps.config.callbackUrl,
      channels: deps.config.channels,
      metadata: { order_reference: attempt.order.reference, environment: deps.config.mode },
    });
    await deps.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: "INITIALIZING" },
      data: { status: "PENDING", authorizationUrl: res.authorizationUrl, failureReason: null },
    });
    return { ok: true, authorizationUrl: res.authorizationUrl };
  } catch (e) {
    const err = e instanceof PaystackError ? e : new PaystackError("network", "Unexpected error");
    if (!err.ambiguous) {
      // Paystack refused: no transaction exists, a fresh attempt is safe later.
      await deps.prisma.paymentAttempt.updateMany({
        where: { id: attempt.id, status: "INITIALIZING" },
        data: { status: "FAILED", failureReason: `Payment could not be started (${err.kind})` },
      });
      log("payment_init_failed", { attempt: attempt.reference, kind: err.kind });
      return { ok: false, reason: "provider_rejected" };
    }
    // Unknown whether Paystack created the transaction: keep the attempt open so
    // it is checked (verify) before any new attempt is made.
    await deps.prisma.paymentAttempt.updateMany({
      where: { id: attempt.id, status: "INITIALIZING" },
      data: { failureReason: `Payment start outcome unknown (${err.kind}); will be checked before retrying` },
    });
    log("payment_init_ambiguous", { attempt: attempt.reference, kind: err.kind });
    return { ok: false, reason: "outcome_unknown" };
  }
}

// --- Verification (the only path to PAID) -----------------------------------------

export type ApplyOutcome =
  | "paid"
  | "already_paid"
  | "duplicate_payment"
  | "pending"
  | "failed"
  | "mismatch"
  | "needs_attention"
  | "unknown_reference"
  | "test_database_not_approved";

export type ApplyResult = { outcome: ApplyOutcome; stockChanged: boolean; receiptQueued: boolean; orderId?: string };

const TERMINAL_FAILURE: Record<string, PaymentStatus> = { failed: "FAILED", abandoned: "ABANDONED", reversed: "REVERSED" };

/** A provider status safe to quote in a note: short, plain characters only. */
function safeStatus(status: string) {
  return /^[a-z_ -]{1,30}$/i.test(status) ? status : "unrecognised";
}

function note(existing: string | null, add: string) {
  return existing ? (existing.includes(add) ? existing : `${existing}\n${add}`) : add;
}

/**
 * Applies an authoritative Paystack verify result to our records. Idempotent and
 * safe under concurrency (order row lock). Never trusts webhook/redirect data.
 */
export async function applyVerification(
  prisma: PrismaClient,
  reference: string,
  tx: PaystackTransaction,
  expectedDomain: "test" | "live",
  opts: { testDatabaseToken?: string | null } = {},
): Promise<ApplyResult> {
  const none = { stockChanged: false, receiptQueued: false };
  const result = await prisma.$transaction(
    async (db): Promise<ApplyResult> => {
      const found = await db.paymentAttempt.findUnique({ where: { reference }, select: { id: true, orderId: true } });
      if (!found) return { outcome: "unknown_reference", ...none };
      await db.$queryRaw`SELECT id FROM "order" WHERE id = ${found.orderId} FOR UPDATE`;
      const attempt = await db.paymentAttempt.findUniqueOrThrow({ where: { id: found.id } });
      // A test transaction may only change data (order status, stock, receipts) in
      // a database approved for test writes, a live one only in a database without
      // that marker. Checked inside the lock, before any write.
      if (!(await databaseApprovedFor(db, attempt.testMode ? "test" : "live", opts.testDatabaseToken))) {
        log("payment_refused_test_database", { attempt: attempt.reference });
        return { orderId: found.orderId, outcome: "test_database_not_approved", ...none };
      }
      const order = await db.order.findUniqueOrThrow({ where: { id: found.orderId }, include: { items: true } });
      const now = new Date();
      const base = { orderId: order.id, ...none };

      const mismatches: string[] = [];
      if (tx.reference !== attempt.reference) mismatches.push("reference");
      if (tx.domain !== expectedDomain || attempt.testMode !== (expectedDomain === "test")) mismatches.push(`environment (${tx.domain})`);
      if (tx.currency !== attempt.currency) mismatches.push(`currency (${tx.currency})`);
      if (tx.amount !== attempt.amountMinor) mismatches.push(`amount (${tx.amount})`);
      if (mismatches.length > 0) {
        // Paystack's own report (verify) stated as such; whether money moved is for the owner to establish.
        const reason =
          `Verification mismatch on ${attempt.reference}: ${mismatches.join(", ")}. Paystack verify reports status "${safeStatus(tx.status)}"; ` +
          `expected ${attempt.amountMinor} ${attempt.currency} (${attempt.testMode ? "test" : "live"}). Not marked paid: check it in the Paystack dashboard.`;
        if (attempt.status !== "SUCCESS") {
          await db.paymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", failureReason: reason.slice(0, 500), lastVerifiedAt: now } });
        }
        await db.order.update({ where: { id: order.id }, data: { needsAttention: note(order.needsAttention, reason) } });
        await queueOwnerAlert(db, order.id, ALERT_KINDS.paymentMismatch, attempt.reference);
        log("payment_mismatch", { attempt: attempt.reference, mismatches });
        return { ...base, outcome: "mismatch" };
      }

      if (tx.status === "success") {
        if (attempt.status === "SUCCESS") return { ...base, outcome: "already_paid" };
        const clash = await db.paymentAttempt.findFirst({ where: { providerTransactionId: tx.id, NOT: { id: attempt.id } }, select: { reference: true } });
        if (clash) {
          const reason = `Paystack verify reports ${attempt.reference} as successful, but its transaction ${tx.id} is already linked to ${clash.reference}. Not marked paid: check both in the Paystack dashboard.`;
          await db.order.update({ where: { id: order.id }, data: { needsAttention: note(order.needsAttention, reason) } });
          await queueOwnerAlert(db, order.id, ALERT_KINDS.transactionConflict, attempt.reference);
          log("payment_transaction_conflict", { attempt: attempt.reference, linkedTo: clash.reference });
          return { ...base, outcome: "mismatch" };
        }
        await db.paymentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: "SUCCESS",
            providerTransactionId: tx.id,
            channel: tx.channel,
            paidAt: tx.paidAt ? new Date(tx.paidAt) : now,
            lastVerifiedAt: now,
            failureReason: null,
          },
        });
        if (order.status === "PAID") {
          const reason = `Second successful payment ${attempt.reference} on an already paid order: refund it manually in Paystack`;
          await db.order.update({ where: { id: order.id }, data: { needsAttention: note(order.needsAttention, reason) } });
          await queueOwnerAlert(db, order.id, ALERT_KINDS.duplicatePayment);
          log("payment_duplicate", { order: order.reference, attempt: attempt.reference });
          return { ...base, outcome: "duplicate_payment" };
        }
        if (order.status !== "PENDING_PAYMENT") {
          // The payment itself is confirmed by Paystack and recorded above; the order is left as it is.
          const reason = `Payment ${attempt.reference} received (confirmed by Paystack) for an order in status ${order.status}: decide whether to fulfil or refund it in Paystack`;
          await db.order.update({ where: { id: order.id }, data: { needsAttention: note(order.needsAttention, reason) } });
          await queueOwnerAlert(db, order.id, ALERT_KINDS.unexpectedPayment, attempt.reference);
          log("payment_unexpected_order_status", { order: order.reference, attempt: attempt.reference, status: order.status });
          return { ...base, outcome: "needs_attention" };
        }

        // Paid: deduct stock exactly once (this branch runs once per order).
        // A line without enough stock is left untouched (never negative) and named for the owner.
        const short: string[] = [];
        for (const item of order.items) {
          const changed = await db.$executeRaw`
            UPDATE "product_variant" SET "stock" = "stock" - ${item.quantity}, "updatedAt" = now()
            WHERE "id" = ${item.variantId} AND "stock" >= ${item.quantity}`;
          if (changed === 0) short.push(`${item.productName} (${item.colour}, size ${item.size}, SKU ${item.sku}) × ${item.quantity}`);
        }
        const shortfall = short.length > 0;
        await db.order.update({
          where: { id: order.id },
          data: {
            status: "PAID",
            paidAt: tx.paidAt ? new Date(tx.paidAt) : now,
            stockStatus: shortfall ? "SHORTFALL" : "DEDUCTED",
            needsAttention: shortfall
              ? note(order.needsAttention, `Paid, but stock was insufficient for: ${short.join("; ")}. Stock was not deducted for these lines.`)
              : order.needsAttention,
          },
        });
        if (shortfall) await queueOwnerAlert(db, order.id, ALERT_KINDS.stockShortfall);
        // Receipt is queued in the same transaction (outbox): exactly one per order.
        await db.emailNotification.upsert({
          where: { orderId_kind: { orderId: order.id, kind: RECEIPT } },
          create: { orderId: order.id, kind: RECEIPT },
          update: {},
        });
        log("payment_confirmed", { order: order.reference, attempt: attempt.reference, channel: tx.channel, shortfall });
        return { orderId: order.id, outcome: "paid", stockChanged: true, receiptQueued: true };
      }

      const failure = TERMINAL_FAILURE[tx.status];
      if (failure) {
        if (attempt.status === "SUCCESS") {
          // Never un-pay automatically; the owner decides.
          const reason = `Paystack now reports ${attempt.reference} as ${tx.status}`;
          await db.order.update({ where: { id: order.id }, data: { needsAttention: note(order.needsAttention, reason) } });
          await queueOwnerAlert(db, order.id, ALERT_KINDS.paymentReversed, `${attempt.reference}:${tx.status}`);
          return { ...base, outcome: "needs_attention" };
        }
        await db.paymentAttempt.update({
          where: { id: attempt.id },
          data: { status: failure, failureReason: tx.gatewayResponse?.slice(0, 200) ?? tx.status, lastVerifiedAt: now },
        });
        return { ...base, outcome: "failed" };
      }

      // ongoing / pending / processing / queued / anything new: still waiting.
      await db.paymentAttempt.update({
        where: { id: attempt.id },
        data: { status: attempt.status === "INITIALIZING" ? "PENDING" : attempt.status, lastVerifiedAt: now },
      });
      return { ...base, outcome: attempt.status === "SUCCESS" ? "already_paid" : "pending" };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
  // After the payment is committed (no locks held). Re-run on every later
  // confirmation of a paid order too, so a missed run is repaired by the next
  // webhook, callback or admin re-check.
  if (result.orderId && (result.outcome === "paid" || result.outcome === "already_paid")) {
    try {
      await flagRelatedPaidOrders(prisma, result.orderId);
    } catch (e) {
      log("duplicate_check_failed", { order: result.orderId, message: e instanceof Error ? e.name : "unknown" });
    }
  }
  return result;
}

const DUPLICATE_WINDOW_MS = 14 * 24 * 60 * 60_000;

/** Appends a note once, atomically (no read-modify-write across requests). */
export async function appendNote(prisma: PrismaClient, orderId: string, text: string) {
  await prisma.$executeRaw`
    UPDATE "order" SET
      "needsAttention" = CASE
        WHEN "needsAttention" IS NULL OR "needsAttention" = '' THEN ${text}
        WHEN strpos("needsAttention", ${text}) > 0 THEN "needsAttention"
        ELSE "needsAttention" || E'\n' || ${text}
      END,
      "updatedAt" = now()
    WHERE "id" = ${orderId}`;
}

/**
 * After an order is paid, other paid orders from the same customer (email) for
 * at least one of the same pieces, in the same mode and within 14 days, may be
 * the same purchase paid twice, e.g. a late payment on an older checkout after
 * the customer paid a newer one. Both are flagged for the owner, who confirms
 * with the customer before fulfilling and refunds one in Paystack if needed.
 * A heuristic for review only: it never changes status, stock or receipts, and
 * every payment stays recorded as it happened. It runs after the payment
 * committed, so of two confirmations at the same moment the later one sees the
 * other and flags both. Idempotent.
 */
async function flagRelatedPaidOrders(prisma: PrismaClient, orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true, reference: true, status: true, testMode: true, customerEmail: true, createdAt: true, items: { select: { variantId: true } } },
  });
  if (!order || order.status !== "PAID") return;
  const related = await prisma.order.findMany({
    where: {
      id: { not: order.id },
      status: "PAID",
      testMode: order.testMode,
      customerEmail: order.customerEmail,
      createdAt: { gte: new Date(order.createdAt.getTime() - DUPLICATE_WINDOW_MS), lte: new Date(order.createdAt.getTime() + DUPLICATE_WINDOW_MS) },
      items: { some: { variantId: { in: order.items.map((i) => i.variantId) } } },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, reference: true },
  });
  const advice = "Confirm with the customer before fulfilling; if it is a duplicate, refund one in Paystack.";
  for (const other of related) {
    await appendNote(prisma, order.id, `Possible duplicate purchase: order ${other.reference} was also paid by the same customer for the same pieces. ${advice}`);
    await appendNote(prisma, other.id, `Possible duplicate purchase: order ${order.reference} was also paid by the same customer for the same pieces. ${advice}`);
    await queueOwnerAlert(prisma, order.id, ALERT_KINDS.duplicatePayment);
    await queueOwnerAlert(prisma, other.id, ALERT_KINDS.duplicatePayment);
  }
  if (related.length > 0) log("payment_possible_duplicate", { order: order.reference, related: related.map((r) => r.reference) });
}

export type VerifyResult = ApplyResult | { outcome: "not_found" | "unverified"; stockChanged: false; receiptQueued: false };

/** Calls Paystack verify (outside any transaction), then applies the result. */
export async function verifyAndApply(deps: PaymentDeps, reference: string): Promise<VerifyResult> {
  let tx: PaystackTransaction;
  try {
    tx = await deps.paystack.verify(reference);
  } catch (e) {
    if (e instanceof PaystackError && e.kind === "not_found") {
      // Paystack never created this transaction. An attempt still INITIALIZING past
      // the grace period can be closed so a new attempt is allowed.
      await deps.prisma.paymentAttempt.updateMany({
        where: { reference, status: "INITIALIZING", createdAt: { lt: new Date(Date.now() - INIT_GRACE_MS) } },
        data: { status: "FAILED", failureReason: "Not found at Paystack (never started)" },
      });
      return { outcome: "not_found", stockChanged: false, receiptQueued: false };
    }
    log("payment_verify_unavailable", { attempt: reference, kind: e instanceof PaystackError ? e.kind : "error" });
    return { outcome: "unverified", stockChanged: false, receiptQueued: false };
  }
  return applyVerification(deps.prisma, reference, tx, deps.config.mode, { testDatabaseToken: deps.config.testDatabaseToken });
}

/**
 * Verifies an order's attempts with Paystack. "open" (the default, used before
 * a new attempt) checks attempts still INITIALIZING or PENDING; "recoverable"
 * also re-checks abandoned or failed attempts that reached a Paystack checkout
 * page (attemptMayStillSucceed), so a late payment whose webhook was lost is
 * still found. Either way only Paystack's verify result changes anything.
 */
export async function reconcileOrder(deps: PaymentDeps, orderId: string, opts: { scope?: "open" | "recoverable" } = {}) {
  const open = await deps.prisma.paymentAttempt.findMany({
    where: { orderId, ...(opts.scope === "recoverable" ? RECOVERABLE_ATTEMPT : { status: { in: ["INITIALIZING", "PENDING"] } }) },
    orderBy: { createdAt: "asc" },
    select: { reference: true },
  });
  let unverified = 0;
  let stockChanged = false;
  let receiptQueued = false;
  for (const a of open) {
    const r = await verifyAndApply(deps, a.reference);
    if (r.outcome === "unverified") unverified++;
    stockChanged ||= r.stockChanged;
    receiptQueued ||= r.receiptQueued;
  }
  const order = await deps.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } });
  return { paid: order.status === "PAID", unverified, stockChanged, receiptQueued };
}

// --- Recovery of payments whose webhook was lost -------------------------------------

/**
 * Attempts that are not known to be paid but could still have been: open ones,
 * and abandoned or failed ones that reached a Paystack checkout page. Excluded:
 * SUCCESS (already applied), REVERSED and FAILED without an authorization URL
 * (final, see attemptMayStillSucceed).
 */
const RECOVERABLE_ATTEMPT = {
  status: { in: ["INITIALIZING", "PENDING", "ABANDONED", "FAILED"] },
  NOT: { status: "FAILED", authorizationUrl: null },
} satisfies Prisma.PaymentAttemptWhereInput;

/** How far back recovery looks. Whether Paystack can complete an older abandoned transaction is not documented. */
export const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60_000;
/** Leave fresh attempts to the customer's own return and the webhook. */
export const RECOVERY_MIN_AGE_MS = 10 * 60_000;
/** An attempt is re-checked at most this often, however often recovery runs. */
export const RECOVERY_RECHECK_MS = 6 * 60 * 60_000;
export const RECOVERY_MAX_BATCH = 25;
/** Consecutive verify failures after which a run stops (Paystack or the database is having trouble). */
const RECOVERY_MAX_FAILURES = 2;

export type RecoverySummary = {
  checked: number;
  /** Outcomes of the attempts that were checked, e.g. { paid: 1, failed: 3 }. */
  outcomes: Record<string, number>;
  /** Claimed by this run but not verified (Paystack or database unavailable); released for the next run. */
  unverified: number;
  /** Already claimed by a concurrent run. */
  skipped: number;
  stoppedEarly: boolean;
  stockChanged: boolean;
  receiptQueued: boolean;
};

/**
 * Re-verifies recent attempts that might have been paid without our hearing of
 * it (lost webhook, customer never came back). Bounded: at most `limit`
 * attempts (≤ RECOVERY_MAX_BATCH) from the last RECOVERY_WINDOW_MS, each at most
 * once per RECOVERY_RECHECK_MS, least recently checked first, one Paystack call
 * each, stopping after repeated failures.
 *
 * Safe to run concurrently or repeatedly: each attempt is claimed by a
 * compare-and-set on lastVerifiedAt, so overlapping runs never verify the same
 * attempt twice, and every result goes through verifyAndApply (Paystack verify,
 * then applyVerification under the order row lock), which is idempotent. A
 * Paystack or database failure changes nothing; the claim is handed back so the
 * attempt is retried on the next run rather than released or marked unpaid.
 */
export async function recoverAttempts(deps: PaymentDeps, opts: { limit?: number; now?: () => Date } = {}): Promise<RecoverySummary> {
  const now = opts.now ?? (() => new Date());
  const limit = Math.max(1, Math.min(opts.limit ?? 10, RECOVERY_MAX_BATCH));
  const start = now().getTime();
  const candidates = await deps.prisma.paymentAttempt.findMany({
    where: {
      ...RECOVERABLE_ATTEMPT,
      testMode: deps.config.mode === "test", // a test attempt is never verified with live credentials, and vice versa
      createdAt: { gte: new Date(start - RECOVERY_WINDOW_MS), lte: new Date(start - RECOVERY_MIN_AGE_MS) },
      OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: new Date(start - RECOVERY_RECHECK_MS) } }],
    },
    orderBy: [{ lastVerifiedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: limit,
    select: { id: true, reference: true, lastVerifiedAt: true },
  });

  const summary: RecoverySummary = { checked: 0, outcomes: {}, unverified: 0, skipped: 0, stoppedEarly: false, stockChanged: false, receiptQueued: false };
  let failuresInARow = 0;
  for (const c of candidates) {
    if (failuresInARow >= RECOVERY_MAX_FAILURES) {
      summary.stoppedEarly = true;
      break;
    }
    const claimedAt = now();
    const claim = await deps.prisma.paymentAttempt.updateMany({
      where: { id: c.id, lastVerifiedAt: c.lastVerifiedAt },
      data: { lastVerifiedAt: claimedAt },
    });
    if (claim.count !== 1) {
      summary.skipped++;
      continue;
    }
    let result: VerifyResult | null = null;
    try {
      result = await verifyAndApply(deps, c.reference);
    } catch (e) {
      log("payment_recovery_error", { attempt: c.reference, error: e instanceof Error ? e.name : "unknown" });
    }
    if (!result || result.outcome === "unverified" || result.outcome === "test_database_not_approved") {
      failuresInARow++;
      summary.unverified++;
      // Hand the claim back (only if nothing else touched the attempt since).
      await deps.prisma.paymentAttempt
        .updateMany({ where: { id: c.id, lastVerifiedAt: claimedAt }, data: { lastVerifiedAt: c.lastVerifiedAt } })
        .catch(() => {});
      continue;
    }
    failuresInARow = 0;
    summary.checked++;
    summary.outcomes[result.outcome] = (summary.outcomes[result.outcome] ?? 0) + 1;
    summary.stockChanged ||= result.stockChanged;
    summary.receiptQueued ||= result.receiptQueued;
    if (result.outcome === "paid") log("payment_recovered", { attempt: c.reference });
  }
  log("payment_recovery_run", { candidates: candidates.length, ...summary });
  return summary;
}

export type NewAttemptResult =
  | { ok: true; authorizationUrl: string; reused: boolean }
  | { ok: false; reason: "already_paid" | "too_many_attempts" | "previous_unconfirmed" | "unavailable" | "not_payable" | "provider_rejected" | "outcome_unknown" };

type AttemptClaim =
  | { kind: "created"; attemptId: string }
  | { kind: "open"; authorizationUrl: string }
  | { kind: "ineligible"; reason: "not_payable" | "previous_unconfirmed" | "too_many_attempts" | "unavailable" };

/**
 * Decides, under a lock on the order row, whether this request may create the
 * next payment attempt, and creates it if so. The row lock (SELECT … FOR UPDATE)
 * makes concurrent retries for one order queue up here; under PostgreSQL's
 * default READ COMMITTED isolation each statement after the lock reads a fresh
 * snapshot, so a waiting request sees the attempt the previous one committed
 * and stops (previous_unconfirmed or open). A transaction alone would not do
 * this: both would read "no open attempt" before either inserts. The same row
 * lock is what applyVerification takes. No network call happens in here.
 */
async function claimNextAttempt(prisma: PrismaClient, orderId: string): Promise<AttemptClaim> {
  return prisma.$transaction(
    async (db) => {
      await db.$queryRaw`SELECT id FROM "order" WHERE id = ${orderId} FOR UPDATE`;
      const order = await db.order.findUniqueOrThrow({
        where: { id: orderId },
        include: { items: true, payments: { orderBy: { createdAt: "desc" } } },
      });
      if (order.status !== "PENDING_PAYMENT") return { kind: "ineligible", reason: "not_payable" };

      const open = order.payments.find((p) => p.status === "PENDING" && p.authorizationUrl && Date.now() - p.createdAt.getTime() < REUSE_PENDING_ATTEMPT_MS);
      if (open?.authorizationUrl) return { kind: "open", authorizationUrl: open.authorizationUrl };
      if (order.payments.some((p) => p.status === "INITIALIZING")) return { kind: "ineligible", reason: "previous_unconfirmed" };
      if (order.payments.length >= MAX_ATTEMPTS_PER_ORDER) return { kind: "ineligible", reason: "too_many_attempts" };

      // The agreed order price stands, but the items must still be sellable.
      const { problems } = await priceBasket(db, order.items.map((i) => ({ variantId: i.variantId, quantity: i.quantity })));
      if (problems.length > 0) return { kind: "ineligible", reason: "unavailable" };

      const attempt = await db.paymentAttempt.create({
        data: { orderId, reference: newPaymentReference(order.reference), testMode: order.testMode, amountMinor: order.totalMinor, currency: order.currency },
        select: { id: true },
      });
      return { kind: "created", attemptId: attempt.id };
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}

/**
 * Starts another payment attempt for an unpaid order, but only after every
 * earlier attempt has been checked with Paystack. A still-open attempt is
 * reused, so a customer is never sent to two live checkouts for one order.
 */
export async function startNewAttempt(deps: PaymentDeps, orderId: string): Promise<NewAttemptResult & { stockChanged?: boolean }> {
  const rec = await reconcileOrder(deps, orderId);
  if (rec.paid) return { ok: false, reason: "already_paid", stockChanged: rec.stockChanged };
  if (rec.unverified > 0) return { ok: false, reason: "previous_unconfirmed" };

  const claim = await claimNextAttempt(deps.prisma, orderId);
  if (claim.kind === "open") return { ok: true, authorizationUrl: claim.authorizationUrl, reused: true };
  if (claim.kind === "ineligible") return { ok: false, reason: claim.reason };

  // Only the request that created this attempt initialises it; the lock is already released.
  const res = await initializeAttempt(deps, claim.attemptId);
  if (res.ok) return { ok: true, authorizationUrl: res.authorizationUrl, reused: false };
  return { ok: false, reason: res.reason === "not_initializable" || res.reason === "test_database_not_approved" ? "not_payable" : res.reason };
}

// --- Read model for the customer status page ----------------------------------

export type CustomerOrderState = "paid" | "pending" | "failed" | "unknown";

export async function getCustomerOrder(prisma: PrismaClient, reference: string) {
  const order = await prisma.order.findUnique({
    where: { reference },
    select: {
      id: true,
      reference: true,
      testMode: true,
      status: true,
      customerName: true,
      currency: true,
      subtotalMinor: true,
      totalMinor: true,
      createdAt: true,
      paidAt: true,
      items: { select: { productName: true, productSlug: true, size: true, colour: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true } },
      payments: { orderBy: { createdAt: "desc" }, select: { status: true, authorizationUrl: true, channel: true, reference: true, createdAt: true, failureReason: true } },
      notifications: { where: { kind: RECEIPT }, select: { status: true } },
    },
  });
  if (!order) return null;
  const latest = order.payments[0];
  let state: CustomerOrderState;
  if (order.status === "PAID") state = "paid";
  else if (!latest) state = "unknown";
  else if (latest.status === "PENDING") state = "pending";
  else if (latest.status === "INITIALIZING") state = latest.failureReason ? "unknown" : "pending";
  else if (latest.status === "SUCCESS") state = "unknown"; // success recorded but order not paid: owner reviews
  else state = "failed";
  return { ...order, state, latestPayment: latest ?? null, receiptStatus: order.notifications[0]?.status ?? null };
}

export type OrderWithItems = Prisma.OrderGetPayload<{ include: { items: true } }>;

function log(event: string, data: Record<string, unknown>) {
  // References only: no customer names, emails or phone numbers in logs.
  console.info(JSON.stringify({ level: "info", event, ...data }));
}
