import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import * as svc from "@/server/orders/order-service";
import { ALERT_KINDS, processOwnerAlerts } from "@/server/notifications/owner-alerts";
import type { Mailer, OutgoingEmail } from "@/server/notifications/mailer";
import { PaystackError } from "@/server/payments/paystack";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Recovery of payments whose webhook was lost (recoverAttempts), and owner
// alerts for payment exceptions. Isolated test database, fake Paystack, fake
// mailer: no network call is made and no email is sent.

const HOUR = 3_600_000;

describe.skipIf(!hasTestDb)("payment recovery and exception alerts", () => {
  const prisma = testPrisma();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let ps: ReturnType<typeof fakePaystack>;
  let deps: svc.PaymentDeps;
  let variantId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    fetchSpy.mockClear();
    ps = fakePaystack();
    deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 250000, variants: [{ size: "M", colour: "White", stock: 3 }] });
    variantId = (await prisma.productVariant.findFirstOrThrow()).id;
  });
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
  afterAll(() => prisma.$disconnect());

  const input = () =>
    checkoutInputSchema.parse({ name: "Amina Secretname", email: "amina.secret@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 250000 });

  /** An order whose attempt reached Paystack's page, aged as if created `ageMs` ago and last checked `checkedAgoMs` ago (null: never). */
  async function startedOrder(opts: { ageMs?: number; checkedAgoMs?: number | null } = {}) {
    const created = await svc.createOrder(prisma, input(), testOrderOpts);
    if (!created.ok) throw new Error(`setup: ${created.reason}`);
    await svc.initializeAttempt(deps, created.attempt.id);
    await age(created.attempt.id, opts);
    return created;
  }
  async function age(attemptId: string, opts: { ageMs?: number; checkedAgoMs?: number | null }) {
    const now = Date.now();
    await prisma.paymentAttempt.update({
      where: { id: attemptId },
      data: { createdAt: new Date(now - (opts.ageMs ?? HOUR)), lastVerifiedAt: opts.checkedAgoMs == null ? null : new Date(now - opts.checkedAgoMs) },
    });
  }
  /** Paystack said "abandoned" and we recorded it; the webhook for a later success never arrives. */
  async function abandonedThenPaidLate(opts: { ageMs?: number } = {}) {
    const created = await startedOrder();
    ps.settle(created.attempt.reference, { status: "abandoned" });
    await svc.verifyAndApply(deps, created.attempt.reference);
    await age(created.attempt.id, { ageMs: opts.ageMs ?? 2 * HOUR, checkedAgoMs: 7 * HOUR });
    ps.settle(created.attempt.reference, { status: "success" });
    return created;
  }
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { payments: { orderBy: { createdAt: "asc" } }, notifications: true } });
  const kinds = async (orderId: string) => (await prisma.emailNotification.findMany({ where: { orderId }, orderBy: { kind: "asc" } })).map((n) => n.kind);
  const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;

  describe("recoverAttempts (H1)", () => {
    it("recovers a late successful payment on an abandoned attempt without any webhook", async () => {
      const { order, attempt } = await abandonedThenPaidLate();
      expect((await orderOf(order.id)).payments[0].status).toBe("ABANDONED");

      const summary = await svc.recoverAttempts(deps);
      expect(summary).toMatchObject({ checked: 1, outcomes: { paid: 1 }, unverified: 0, stockChanged: true, receiptQueued: true });
      const o = await orderOf(order.id);
      expect(o).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED" });
      expect(o.payments[0]).toMatchObject({ status: "SUCCESS", providerTransactionId: expect.any(String) });
      expect(await stock()).toBe(2);
      expect(await kinds(order.id)).toEqual(["PAYMENT_RECEIPT"]);
      expect(ps.verified.filter((r) => r === attempt.reference)).toHaveLength(2); // the abandoned check, then recovery
    });

    it("re-checks a failed attempt that reached Paystack, but never a final one", async () => {
      const reachable = await startedOrder({ checkedAgoMs: null });
      await prisma.paymentAttempt.update({ where: { id: reachable.attempt.id }, data: { status: "FAILED" } });
      ps.settle(reachable.attempt.reference, { status: "success" });

      const neverStarted = await startedOrder({ checkedAgoMs: null }); // FAILED without a checkout page: final
      await prisma.paymentAttempt.update({ where: { id: neverStarted.attempt.id }, data: { status: "FAILED", authorizationUrl: null } });
      const reversed = await startedOrder({ checkedAgoMs: null });
      await prisma.paymentAttempt.update({ where: { id: reversed.attempt.id }, data: { status: "REVERSED" } });

      await svc.recoverAttempts(deps);
      expect(ps.verified).toEqual([reachable.attempt.reference]);
      expect((await orderOf(reachable.order.id)).status).toBe("PAID");
    });

    it("stays within its window and batch size, least recently checked first", async () => {
      const fresh = await startedOrder({ ageMs: 60_000 }); // the customer may still be on the page
      const tooOld = await startedOrder({ ageMs: 8 * 24 * HOUR });
      const recentlyChecked = await startedOrder({ checkedAgoMs: HOUR });
      const a = await startedOrder({ checkedAgoMs: 30 * HOUR });
      const b = await startedOrder({ checkedAgoMs: null });
      const c = await startedOrder({ checkedAgoMs: 10 * HOUR });

      const summary = await svc.recoverAttempts(deps, { limit: 2 });
      expect(summary.checked).toBe(2);
      expect(ps.verified).toEqual([b.attempt.reference, a.attempt.reference]); // never checked, then the oldest check
      await svc.recoverAttempts(deps, { limit: 2 });
      expect(ps.verified).toEqual([b.attempt.reference, a.attempt.reference, c.attempt.reference]);
      for (const skipped of [fresh, tooOld, recentlyChecked]) expect(ps.verified).not.toContain(skipped.attempt.reference);
    });

    it("never verifies an attempt of the other mode", async () => {
      const created = await startedOrder({ checkedAgoMs: null });
      await prisma.paymentAttempt.update({ where: { id: created.attempt.id }, data: { testMode: false } });
      expect(await svc.recoverAttempts(deps)).toMatchObject({ checked: 0 });
      expect(ps.verified).toEqual([]);
    });

    it("is idempotent when repeated: an attempt is checked once per interval, a payment applied once", async () => {
      const { order } = await abandonedThenPaidLate();
      const pending = await startedOrder({ checkedAgoMs: null }); // stays "ongoing" at Paystack
      await svc.recoverAttempts(deps);
      const checks = ps.verified.length;
      expect(await svc.recoverAttempts(deps)).toMatchObject({ checked: 0 });
      expect(ps.verified).toHaveLength(checks); // nothing re-checked within RECOVERY_RECHECK_MS
      expect(await stock()).toBe(2);
      expect(await kinds(order.id)).toEqual(["PAYMENT_RECEIPT"]);
      expect((await orderOf(pending.order.id)).payments[0].status).toBe("PENDING");
    });

    it("is safe under concurrent runs: each attempt verified once, stock and receipts applied once", async () => {
      const late = [await abandonedThenPaidLate(), await abandonedThenPaidLate()];
      const results = await Promise.all([svc.recoverAttempts(deps), svc.recoverAttempts(deps), svc.recoverAttempts(deps)]);
      const recoveryChecks = ps.verified.slice(2); // after the two "abandoned" checks in setup
      expect(new Set(recoveryChecks).size).toBe(recoveryChecks.length);
      expect(results.reduce((n, r) => n + r.checked, 0)).toBe(2);
      expect(results.reduce((n, r) => n + (r.outcomes.paid ?? 0), 0)).toBe(2);
      for (const { order } of late) {
        expect((await orderOf(order.id)).status).toBe("PAID");
        // One receipt each (same customer and piece, so each also carries one possible-duplicate alert).
        expect(await kinds(order.id)).toEqual([ALERT_KINDS.duplicatePayment, "PAYMENT_RECEIPT"]);
      }
      expect(await stock()).toBe(1); // 3 − one each
    });

    it("changes nothing during a Paystack outage, stops early and retries on the next run", async () => {
      const late = [await abandonedThenPaidLate(), await abandonedThenPaidLate(), await abandonedThenPaidLate()];
      const before = await prisma.paymentAttempt.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, lastVerifiedAt: true } });
      ps.failVerify(new PaystackError("http", "Paystack responded with HTTP 503", 503));

      const summary = await svc.recoverAttempts(deps);
      expect(summary).toMatchObject({ checked: 0, unverified: 2, stoppedEarly: true, stockChanged: false });
      // Not marked unpaid or released, and the claims were handed back.
      expect(await prisma.paymentAttempt.findMany({ orderBy: { id: "asc" }, select: { id: true, status: true, lastVerifiedAt: true } })).toEqual(before);
      for (const { order } of late) expect((await orderOf(order.id)).status).toBe("PENDING_PAYMENT");
      expect(await stock()).toBe(3);

      ps.failVerify(null);
      expect(await svc.recoverAttempts(deps)).toMatchObject({ checked: 3, outcomes: { paid: 3 } });
    });

    it("treats a database failure during one attempt like an outage: nothing applied, claim handed back", async () => {
      const { attempt } = await abandonedThenPaidLate();
      const failing = { ...deps, paystack: { ...ps.client, verify: async () => { throw new Error("connection reset"); } } };
      const before = await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
      expect(await svc.recoverAttempts(failing)).toMatchObject({ checked: 0, unverified: 1 });
      expect(await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ status: before.status, lastVerifiedAt: before.lastVerifiedAt });
    });

    it("finds a late second payment on an already paid order and alerts the owner", async () => {
      const first = await startedOrder();
      const second = await svc.startNewAttempt(deps, first.order.id); // customer opened a second checkout
      expect(second.ok).toBe(true);
      const attempts = await prisma.paymentAttempt.findMany({ where: { orderId: first.order.id }, orderBy: { createdAt: "asc" } });
      ps.settle(attempts[0].reference, { status: "success" });
      await svc.verifyAndApply(deps, attempts[0].reference);
      ps.settle(attempts[1].reference, { status: "success" }); // its webhook is lost
      await age(attempts[1].id, { checkedAgoMs: null });

      expect(await svc.recoverAttempts(deps)).toMatchObject({ outcomes: { duplicate_payment: 1 } });
      expect(await kinds(first.order.id)).toEqual([ALERT_KINDS.duplicatePayment, "PAYMENT_RECEIPT"]);
      expect(await stock()).toBe(2); // deducted once
    });

    it("re-checks closed attempts from the admin or customer check ('recoverable' scope) but not before a new attempt", async () => {
      const { order, attempt } = await abandonedThenPaidLate();
      expect(await svc.reconcileOrder(deps, order.id)).toMatchObject({ paid: false }); // open attempts only
      expect(ps.verified.filter((r) => r === attempt.reference)).toHaveLength(1);
      expect(await svc.reconcileOrder(deps, order.id, { scope: "recoverable" })).toMatchObject({ paid: true, stockChanged: true, receiptQueued: true });
    });
  });

  describe("nonexistent reference versus transient failure (M1)", () => {
    async function ambiguousInit() {
      ps.failInitialize(new PaystackError("timeout", "Paystack request timed out"));
      const created = await svc.createOrder(prisma, input(), testOrderOpts);
      if (!created.ok) throw new Error("setup");
      expect(await svc.initializeAttempt(deps, created.attempt.id)).toEqual({ ok: false, reason: "outcome_unknown" });
      ps.failInitialize(null);
      await age(created.attempt.id, { ageMs: HOUR, checkedAgoMs: null });
      return created;
    }

    it("closes an attempt Paystack confirms doesn't exist, so a new attempt is allowed", async () => {
      const { order, attempt } = await ambiguousInit(); // the fake answers verify with Paystack's 404 (not_found)
      expect(await svc.recoverAttempts(deps)).toMatchObject({ checked: 1, outcomes: { not_found: 1 } });
      expect((await orderOf(order.id)).payments[0]).toMatchObject({ status: "FAILED", failureReason: "Not found at Paystack (never started)" });
      expect(await svc.startNewAttempt(deps, order.id)).toMatchObject({ ok: true, reused: false });
      expect(ps.verified).toContain(attempt.reference);
    });

    it.each([
      ["a 404 that isn't Paystack's error body", new PaystackError("invalid_response", "Unexpected 404 response", 404)],
      ["a 400 validation error", new PaystackError("rejected", "Paystack responded with HTTP 400", 400)],
      ["a bad key (401)", new PaystackError("rejected", "Paystack responded with HTTP 401", 401)],
      ["a rate limit (429)", new PaystackError("rejected", "Paystack responded with HTTP 429", 429)],
      ["an outage (503)", new PaystackError("http", "Paystack responded with HTTP 503", 503)],
      ["a network failure", new PaystackError("network", "Could not reach Paystack")],
    ])("keeps the attempt open on %s", async (_l, error) => {
      const { order } = await ambiguousInit();
      ps.failVerify(error);
      expect(await svc.recoverAttempts(deps)).toMatchObject({ checked: 0, unverified: 1 });
      expect((await orderOf(order.id)).payments[0].status).toBe("INITIALIZING");
      expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "previous_unconfirmed" });
    });
  });

  describe("owner alerts for payment exceptions (M2)", () => {
    it("alerts once per attempt on a verification mismatch, however often or concurrently it is verified", async () => {
      const { order, attempt } = await startedOrder();
      ps.settle(attempt.reference, { status: "success", amount: 100 });
      await Promise.all([1, 2, 3].map(() => svc.verifyAndApply(deps, attempt.reference)));
      await svc.verifyAndApply(deps, attempt.reference);
      const o = await orderOf(order.id);
      expect(o).toMatchObject({ status: "PENDING_PAYMENT", stockStatus: "NOT_APPLIED" });
      expect(o.payments[0].status).toBe("FAILED");
      expect(o.needsAttention).toContain(`Verification mismatch on ${attempt.reference}: amount (100). Paystack verify reports status "success"; expected 250000 KES (test). Not marked paid`);
      expect(await kinds(order.id)).toEqual([`${ALERT_KINDS.paymentMismatch}:${attempt.reference}`]);
      expect(await stock()).toBe(3);
    });

    it("alerts when a success's Paystack transaction is already linked to another payment, without paying", async () => {
      const a = await startedOrder();
      ps.settle(a.attempt.reference, { status: "success" });
      await svc.verifyAndApply(deps, a.attempt.reference);
      const linked = (await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: a.attempt.id } })).providerTransactionId!;

      const b = await startedOrder();
      ps.settle(b.attempt.reference, { status: "success", id: linked });
      expect(await svc.verifyAndApply(deps, b.attempt.reference)).toMatchObject({ outcome: "mismatch", stockChanged: false });
      await svc.verifyAndApply(deps, b.attempt.reference);
      const o = await orderOf(b.order.id);
      expect(o.status).toBe("PENDING_PAYMENT");
      expect(o.payments[0].status).not.toBe("SUCCESS");
      expect(o.needsAttention).toContain(`its transaction ${linked} is already linked to ${a.attempt.reference}`);
      expect(await kinds(b.order.id)).toEqual([`${ALERT_KINDS.transactionConflict}:${b.attempt.reference}`]);
      expect(await stock()).toBe(2); // only order A deducted
    });

    it("records and alerts a confirmed payment on an order no longer awaiting payment, leaving the order alone", async () => {
      const { order, attempt } = await startedOrder();
      await prisma.order.update({ where: { id: order.id }, data: { status: "CANCELLED" } });
      ps.settle(attempt.reference, { status: "success" });
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "needs_attention", stockChanged: false, receiptQueued: false });
      await svc.verifyAndApply(deps, attempt.reference);
      const o = await orderOf(order.id);
      expect(o.status).toBe("CANCELLED");
      expect(o.payments[0]).toMatchObject({ status: "SUCCESS", providerTransactionId: expect.any(String) }); // the payment record is kept
      expect(o.needsAttention).toContain("received (confirmed by Paystack) for an order in status CANCELLED");
      expect(await kinds(order.id)).toEqual([`${ALERT_KINDS.unexpectedPayment}:${attempt.reference}`]); // no receipt
      expect(await stock()).toBe(3);
    });

    it("alerts once when a confirmed payment is later reported reversed, never un-paying", async () => {
      const { order, attempt } = await startedOrder();
      ps.settle(attempt.reference, { status: "success" });
      await svc.verifyAndApply(deps, attempt.reference);
      ps.settle(attempt.reference, { status: "reversed" });
      await svc.verifyAndApply(deps, attempt.reference);
      await svc.verifyAndApply(deps, attempt.reference);
      const o = await orderOf(order.id);
      expect(o).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED" });
      expect(o.payments[0].status).toBe("SUCCESS");
      expect(await kinds(order.id)).toEqual([`${ALERT_KINDS.paymentReversed}:${attempt.reference}:reversed`, "PAYMENT_RECEIPT"]);
      expect(await stock()).toBe(2);
    });

    it("sends exception alerts naming the order and what they concern, never the customer", async () => {
      const { order, attempt } = await startedOrder();
      ps.settle(attempt.reference, { status: "success", amount: 100 });
      await svc.verifyAndApply(deps, attempt.reference);
      const sent: OutgoingEmail[] = [];
      const mailer: Mailer = { name: "fake", send: async (m) => (sent.push(m), { messageId: "m-1" }) };
      expect(await processOwnerAlerts(prisma, mailer, { siteUrl: "https://example.test", ownerEmail: "owner@example.com" })).toMatchObject({ sent: 1 });
      expect(await processOwnerAlerts(prisma, mailer, { siteUrl: "https://example.test", ownerEmail: "owner@example.com" })).toMatchObject({ claimed: 0 });
      expect(sent).toHaveLength(1);
      const [mail] = sent;
      expect(mail.subject).toBe(`[TEST] Merven order ${order.reference}: payment details don't match Paystack`);
      expect(mail.text).toContain(`Concerning: ${attempt.reference}`);
      expect(mail.text).toContain(`https://example.test/admin/orders/${order.id}`);
      expect(`${mail.subject}\n${mail.text}\n${mail.html}`).not.toMatch(/Amina|Secretname|amina\.secret|0712345678|254712345678/);
    });
  });
});
