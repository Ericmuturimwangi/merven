import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ORDER_REFERENCE_PATTERN } from "@/server/orders/access";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import * as svc from "@/server/orders/order-service";
import { PaystackError } from "@/server/payments/paystack";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Payment lifecycle against the isolated test database with a fake Paystack.
// No network calls are made.

describe.skipIf(!hasTestDb)("orders and payments", () => {
  const prisma = testPrisma();
  let ps: ReturnType<typeof fakePaystack>;
  let deps: svc.PaymentDeps;
  let dress: { id: string; m: string; l: string };
  let trousers: { id: string; v: string };

  const input = (items: { variantId: string; quantity: number }[], expectedTotalMinor: number) =>
    checkoutInputSchema.parse({ name: "Amina Otieno", email: "Amina@Example.com", phone: "0712 345 678", items, expectedTotalMinor });

  async function variant(slug: string, size: string) {
    return (await prisma.productVariant.findFirstOrThrow({ where: { product: { slug }, size } })).id;
  }

  beforeEach(async () => {
    await resetDb(prisma);
    ps = fakePaystack();
    deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const cat = await makeCategory(prisma, "Dresses");
    const d = await makeProduct(prisma, {
      categoryId: cat.id,
      slug: "tie-dress",
      priceMinor: 380000,
      variants: [
        { size: "M", colour: "White", stock: 3 },
        { size: "L", colour: "White", stock: 1, priceMinor: 420000 },
      ],
    });
    dress = { id: d.id, m: await variant("tie-dress", "M"), l: await variant("tie-dress", "L") };
    const t = await makeProduct(prisma, { categoryId: cat.id, slug: "trousers", priceMinor: 480000, variants: [{ size: "10", colour: "Black", stock: 5 }] });
    trousers = { id: t.id, v: await variant("trousers", "10") };
  });
  afterAll(() => prisma.$disconnect());

  async function newOrder(items = [{ variantId: dress.m, quantity: 2 }], total = 760000) {
    const res = await svc.createOrder(prisma, input(items, total), testOrderOpts);
    if (!res.ok) throw new Error(`order not created: ${res.reason}`);
    return res;
  }
  const stockOf = async (id: string) => (await prisma.productVariant.findUniqueOrThrow({ where: { id } })).stock;
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { payments: { orderBy: { createdAt: "asc" } }, notifications: true, items: true } });

  describe("order creation", () => {
    it("prices everything on the server and snapshots the items", async () => {
      const res = await newOrder([{ variantId: dress.m, quantity: 2 }, { variantId: dress.l, quantity: 1 }, { variantId: trousers.v, quantity: 1 }], 2 * 380000 + 420000 + 480000);
      const order = await orderOf(res.order.id);
      expect(order).toMatchObject({ status: "PENDING_PAYMENT", testMode: true, subtotalMinor: 1660000, totalMinor: 1660000, currency: "KES", customerEmail: "amina@example.com", customerPhone: "+254712345678" });
      expect(order.reference).toMatch(ORDER_REFERENCE_PATTERN);
      expect(order.reference.startsWith("TEST-MRV-")).toBe(true);
      expect(order.items.map((i) => [i.size, i.quantity, i.unitPriceMinor, i.lineTotalMinor])).toEqual(
        expect.arrayContaining([["M", 2, 380000, 760000], ["L", 1, 420000, 420000], ["10", 1, 480000, 480000]]),
      );
      expect(order.payments).toHaveLength(1);
      expect(order.payments[0]).toMatchObject({ status: "INITIALIZING", amountMinor: 1660000, testMode: true });
      expect(order.payments[0].reference.startsWith(`${order.reference}-P`)).toBe(true);
      // Catalogue edits after checkout never change the order.
      await prisma.product.update({ where: { id: dress.id }, data: { name: "Renamed", priceMinor: 1 } });
      expect((await orderOf(res.order.id)).items.find((i) => i.size === "M")?.productName).toBe("tie dress");
    });

    it("rejects a tampered (lower) client total without creating anything", async () => {
      const res = await svc.createOrder(prisma, input([{ variantId: dress.m, quantity: 2 }], 100), testOrderOpts);
      expect(res).toEqual({ ok: false, reason: "price_changed", subtotalMinor: 760000 });
      expect(await prisma.order.count()).toBe(0);
    });

    it("sends the customer back to review when the price changed after they reviewed it", async () => {
      await prisma.product.update({ where: { id: dress.id }, data: { priceMinor: 400000 } });
      const res = await svc.createOrder(prisma, input([{ variantId: dress.m, quantity: 1 }], 380000), testOrderOpts);
      expect(res).toMatchObject({ ok: false, reason: "price_changed", subtotalMinor: 400000 });
    });

    it.each([
      ["unpublished product", async () => prisma.product.update({ where: { id: dress.id }, data: { status: "DRAFT" } }), "unavailable"],
      ["archived product", async () => prisma.product.update({ where: { id: dress.id }, data: { status: "ARCHIVED" } }), "unavailable"],
      ["inactive variant", async () => prisma.productVariant.update({ where: { id: dress.m }, data: { active: false } }), "unavailable"],
      ["sold-out variant", async () => prisma.productVariant.update({ where: { id: dress.m }, data: { stock: 0 } }), "sold_out"],
      ["not enough stock", async () => prisma.productVariant.update({ where: { id: dress.m }, data: { stock: 1 } }), "insufficient_stock"],
    ])("refuses a %s", async (_l, arrange, kind) => {
      await arrange();
      const res = await svc.createOrder(prisma, input([{ variantId: dress.m, quantity: 2 }], 760000), testOrderOpts);
      expect(res).toMatchObject({ ok: false, reason: "unavailable", problems: [expect.objectContaining({ kind })] });
      expect(await prisma.order.count()).toBe(0);
    });

    it("refuses unknown variants and merged quantities above the per-line limit", async () => {
      expect(await svc.createOrder(prisma, input([{ variantId: "doesnotexist", quantity: 1 }], 0), testOrderOpts)).toMatchObject({ reason: "unavailable" });
      await prisma.productVariant.update({ where: { id: trousers.v }, data: { stock: 50 } });
      const res = await svc.createOrder(prisma, input([{ variantId: trousers.v, quantity: 4 }, { variantId: trousers.v, quantity: 3 }], 7 * 480000), testOrderOpts);
      expect(res).toMatchObject({ ok: false, problems: [expect.objectContaining({ kind: "quantity_limit" })] });
    });
  });

  describe("payment initialisation", () => {
    it("sends the persisted server amount and customer email, with the trusted callback", async () => {
      const { attempt } = await newOrder();
      const res = await svc.initializeAttempt(deps, attempt.id);
      expect(res).toEqual({ ok: true, authorizationUrl: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\//) });
      expect(ps.initialized[0]).toMatchObject({ email: "amina@example.com", amountMinor: 760000, currency: "KES", reference: attempt.reference, callbackUrl: testPaymentConfig.callbackUrl, channels: ["card", "mobile_money"] });
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("PENDING");
    });

    it("marks a refused initialisation as failed, and allows a fresh attempt", async () => {
      const { order, attempt } = await newOrder();
      ps.failInitialize(new PaystackError("rejected", "bad", 400));
      expect(await svc.initializeAttempt(deps, attempt.id)).toEqual({ ok: false, reason: "provider_rejected" });
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("FAILED");
      ps.failInitialize(null);
      const again = await svc.startNewAttempt(deps, order.id);
      expect(again).toMatchObject({ ok: true, reused: false });
      expect((await orderOf(order.id)).payments.map((p) => p.status)).toEqual(["FAILED", "PENDING"]);
    });

    it("never blindly retries an ambiguous initialisation", async () => {
      const { order, attempt } = await newOrder();
      ps.failInitialize(new PaystackError("timeout", "timed out"));
      expect(await svc.initializeAttempt(deps, attempt.id)).toEqual({ ok: false, reason: "outcome_unknown" });
      expect((await prisma.paymentAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe("INITIALIZING");

      // Within the grace period, Paystack's "not found" is not trusted yet: no new attempt.
      ps.failInitialize(null);
      expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "previous_unconfirmed" });
      expect(ps.initialized).toHaveLength(1);

      // Later, if Paystack confirms it never created the transaction, a new attempt is allowed.
      await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } });
      expect(await svc.startNewAttempt(deps, order.id)).toMatchObject({ ok: true, reused: false });
    });

    it("recovers when the 'failed' initialisation actually created a transaction that was paid", async () => {
      const { order, attempt } = await newOrder();
      ps.failInitialize(new PaystackError("network", "reset"));
      await svc.initializeAttempt(deps, attempt.id);
      ps.create(attempt.reference, 760000, "success");
      ps.settle(attempt.reference, { status: "success" });
      expect(await svc.startNewAttempt(deps, order.id)).toMatchObject({ ok: false, reason: "already_paid" });
      expect((await orderOf(order.id)).status).toBe("PAID");
    });

    it("refuses to start a new attempt while Paystack can't be reached to check the old one", async () => {
      const { order, attempt } = await newOrder();
      await svc.initializeAttempt(deps, attempt.id);
      ps.failVerify(new PaystackError("http", "down", 503));
      expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "previous_unconfirmed" });
    });
  });

  describe("verification (the only path to PAID)", () => {
    async function pendingOrder() {
      const o = await newOrder();
      await svc.initializeAttempt(deps, o.attempt.id);
      return o;
    }

    it("confirms payment, deducts stock once and queues one receipt", async () => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "success" });
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "paid", stockChanged: true, receiptQueued: true });
      const o = await orderOf(order.id);
      expect(o).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED", needsAttention: null });
      expect(o.paidAt).toBeInstanceOf(Date);
      expect(o.payments[0]).toMatchObject({ status: "SUCCESS", channel: "mobile_money", providerTransactionId: expect.any(String) });
      expect(o.notifications).toHaveLength(1);
      expect(await stockOf(dress.m)).toBe(1);
    });

    it("is idempotent: callback then webhook (or repeats) change nothing further", async () => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "success" });
      await svc.verifyAndApply(deps, attempt.reference);
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "already_paid", stockChanged: false, receiptQueued: false });
      expect(await stockOf(dress.m)).toBe(1);
      expect((await orderOf(order.id)).notifications).toHaveLength(1);
    });

    it("applies concurrent confirmations exactly once", async () => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "success" });
      const results = await Promise.all(Array.from({ length: 6 }, () => svc.verifyAndApply(deps, attempt.reference)));
      expect(results.filter((r) => r.outcome === "paid")).toHaveLength(1);
      expect(results.filter((r) => r.outcome === "already_paid")).toHaveLength(5);
      expect(await stockOf(dress.m)).toBe(1);
      expect(await prisma.emailNotification.count({ where: { orderId: order.id } })).toBe(1);
    });

    it.each([
      ["a different amount", { amount: 100 }],
      ["a different currency", { currency: "NGN" }],
      ["a live transaction in test mode", { domain: "live" }],
      ["a different reference", { reference: "SOMETHING-ELSE" }],
    ])("does not pay an order for %s", async (_l, patch) => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "success", ...patch });
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "mismatch", stockChanged: false });
      const o = await orderOf(order.id);
      expect(o.status).toBe("PENDING_PAYMENT");
      expect(o.payments[0].status).toBe("FAILED");
      expect(o.needsAttention).toMatch(/mismatch/);
      // No receipt; one owner alert for this attempt.
      expect(o.notifications.map((n) => n.kind)).toEqual([`ALERT_PAYMENT_MISMATCH:${attempt.reference}`]);
      expect(await stockOf(dress.m)).toBe(3);
    });

    it("keeps an M-PESA prompt pending, then confirms when it completes", async () => {
      const { order, attempt } = await pendingOrder();
      for (const status of ["ongoing", "pending", "processing", "queued", "send_otp"]) {
        ps.settle(attempt.reference, { status });
        expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "pending" });
      }
      expect((await orderOf(order.id)).status).toBe("PENDING_PAYMENT");
      ps.settle(attempt.reference, { status: "success" });
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "paid" });
    });

    it("records failures and keeps attempt history across retries", async () => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "abandoned" });
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "failed" });
      const second = await svc.startNewAttempt(deps, order.id);
      expect(second).toMatchObject({ ok: true, reused: false });
      const o1 = await orderOf(order.id);
      ps.settle(o1.payments[1].reference, { status: "success" });
      expect(await svc.verifyAndApply(deps, o1.payments[1].reference)).toMatchObject({ outcome: "paid" });
      expect((await orderOf(order.id)).payments.map((p) => p.status)).toEqual(["ABANDONED", "SUCCESS"]);
    });

    it("reuses an open checkout instead of starting a second one", async () => {
      const { order } = await pendingOrder();
      const again = await svc.startNewAttempt(deps, order.id);
      expect(again).toMatchObject({ ok: true, reused: true });
      expect(ps.initialized).toHaveLength(1);
    });

    it("flags a second successful payment for a manual refund, without deducting stock twice", async () => {
      const { order, attempt } = await pendingOrder();
      // Second attempt created while the first checkout was still open in another tab.
      const second = await prisma.paymentAttempt.create({ data: { orderId: order.id, reference: `${order.reference}-PDUPLICATE`, testMode: true, amountMinor: 760000, currency: "KES" } });
      await svc.initializeAttempt(deps, second.id);
      ps.settle(attempt.reference, { status: "success" });
      ps.settle(second.reference, { status: "success" });
      await svc.verifyAndApply(deps, attempt.reference);
      expect(await svc.verifyAndApply(deps, second.reference)).toMatchObject({ outcome: "duplicate_payment", stockChanged: false });
      const o = await orderOf(order.id);
      expect(o.needsAttention).toMatch(/refund it manually/);
      expect(await stockOf(dress.m)).toBe(1);
      expect(o.notifications.map((n) => n.kind).sort()).toEqual(["ALERT_DUPLICATE_PAYMENT", "PAYMENT_RECEIPT"]); // one receipt, one owner alert
    });

    it("flags a stock shortfall instead of refusing or refunding a confirmed payment", async () => {
      const { order, attempt } = await pendingOrder();
      await prisma.productVariant.update({ where: { id: dress.m }, data: { stock: 1 } }); // sold elsewhere meanwhile
      ps.settle(attempt.reference, { status: "success" });
      await svc.verifyAndApply(deps, attempt.reference);
      const o = await orderOf(order.id);
      expect(o).toMatchObject({ status: "PAID", stockStatus: "SHORTFALL" });
      expect(o.needsAttention).toMatch(/stock was insufficient/);
      expect(await stockOf(dress.m)).toBe(1); // never negative
    });

    it("never un-pays an order when Paystack later reports a reversal", async () => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "success" });
      await svc.verifyAndApply(deps, attempt.reference);
      ps.settle(attempt.reference, { status: "reversed" });
      expect(await svc.verifyAndApply(deps, attempt.reference)).toMatchObject({ outcome: "needs_attention" });
      const o = await orderOf(order.id);
      expect(o.status).toBe("PAID");
      expect(o.needsAttention).toMatch(/reversed/);
    });

    it("limits the number of attempts per order", async () => {
      const { order } = await newOrder();
      ps.failInitialize(new PaystackError("rejected", "no", 400));
      await svc.initializeAttempt(deps, (await orderOf(order.id)).payments[0].id);
      for (let i = 1; i < svc.MAX_ATTEMPTS_PER_ORDER; i++) await svc.startNewAttempt(deps, order.id);
      expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "too_many_attempts" });
    });

    it("refuses a retry when an item became unavailable", async () => {
      const { order, attempt } = await pendingOrder();
      ps.settle(attempt.reference, { status: "failed" });
      await svc.verifyAndApply(deps, attempt.reference);
      await prisma.product.update({ where: { id: dress.id }, data: { status: "ARCHIVED" } });
      expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "unavailable" });
    });

    it("describes each state for the customer page", async () => {
      const { order, attempt } = await pendingOrder();
      expect((await svc.getCustomerOrder(prisma, order.reference))?.state).toBe("pending");
      ps.settle(attempt.reference, { status: "failed" });
      await svc.verifyAndApply(deps, attempt.reference);
      expect((await svc.getCustomerOrder(prisma, order.reference))?.state).toBe("failed");
      expect(await svc.getCustomerOrder(prisma, "TEST-MRV-0000000000")).toBeNull();
    });
  });
});
