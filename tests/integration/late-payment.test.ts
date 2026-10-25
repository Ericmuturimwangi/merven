import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as svc from "@/server/orders/order-service";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Late payments (H1). Whether Paystack can complete a transaction it earlier
// reported as abandoned or failed is not confirmed, so the system must stay
// correct if it does: record the payment truthfully, never deduct stock twice
// for one order, never hand an order's checkout key on while one of its pages
// could still be paid, and flag related paid orders for the owner.

describe.skipIf(!hasTestDb)("late payments", () => {
  const prisma = testPrisma();
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let ps: ReturnType<typeof fakePaystack>;
  let deps: svc.PaymentDeps;
  let variantId: string;
  let otherVariantId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    fetchSpy.mockClear();
    ps = fakePaystack();
    deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 250000, variants: [{ size: "M", colour: "White", stock: 5 }] });
    await makeProduct(prisma, { categoryId: cat.id, slug: "wrap-top", priceMinor: 100000, variants: [{ size: "M", colour: "Black", stock: 5 }] });
    variantId = (await prisma.productVariant.findFirstOrThrow({ where: { colour: "White" } })).id;
    otherVariantId = (await prisma.productVariant.findFirstOrThrow({ where: { colour: "Black" } })).id;
  });
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
  afterAll(() => prisma.$disconnect());

  const input = (email = "amina@example.com", items = [{ variantId, quantity: 1 }], total = 250000) =>
    checkoutInputSchema.parse({ name: "Amina Otieno", email, phone: "0712345678", items, expectedTotalMinor: total });
  /** An unpaid order whose first attempt reached Paystack (it has a checkout page). */
  async function startedOrder(opts: { email?: string; checkoutKey?: string } = {}) {
    const created = await svc.createOrder(prisma, input(opts.email), { ...testOrderOpts, checkoutKey: opts.checkoutKey });
    if (!created.ok) throw new Error(`setup: ${created.reason}`);
    expect((await svc.initializeAttempt(deps, created.attempt.id)).ok).toBe(true);
    return { order: created.order, attempt: created.attempt };
  }
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { payments: true, notifications: true } });
  const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
  /** Uses every remaining attempt; `reachedPaystack` decides whether they had checkout pages. */
  async function exhaust(order: { id: string; reference: string }, reachedPaystack: boolean) {
    await prisma.paymentAttempt.updateMany({ where: { orderId: order.id }, data: reachedPaystack ? { status: "ABANDONED" } : { status: "FAILED", authorizationUrl: null } });
    for (let i = 1; i < svc.MAX_ATTEMPTS_PER_ORDER; i++) {
      await prisma.paymentAttempt.create({
        data: {
          orderId: order.id,
          reference: `${order.reference}-PLATE000${i}`,
          testMode: true,
          status: reachedPaystack ? "ABANDONED" : "FAILED",
          authorizationUrl: reachedPaystack ? `https://checkout.paystack.com/late000${i}` : null,
          amountMinor: 250000,
          currency: "KES",
        },
      });
    }
  }

  it("records a success that arrives after Paystack reported the attempt abandoned, exactly once", async () => {
    const { order, attempt } = await startedOrder();
    ps.settle(attempt.reference, { status: "abandoned" });
    expect((await svc.verifyAndApply(deps, attempt.reference)).outcome).toBe("failed");
    expect((await orderOf(order.id)).payments[0].status).toBe("ABANDONED");
    // The customer completes the same Paystack page later.
    ps.settle(attempt.reference, { status: "success" });
    expect((await svc.verifyAndApply(deps, attempt.reference)).outcome).toBe("paid");
    expect((await svc.verifyAndApply(deps, attempt.reference)).outcome).toBe("already_paid"); // duplicate webhook
    const paid = await orderOf(order.id);
    expect(paid).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED" });
    expect(paid.payments[0].status).toBe("SUCCESS");
    expect(paid.notifications).toHaveLength(1);
    expect(await stock()).toBe(4); // deducted once
  });

  it("keeps the checkout key of an exhausted order while any of its Paystack pages could still be paid", async () => {
    const key = "k".repeat(64);
    const { order } = await startedOrder({ checkoutKey: key });
    await exhaust(order, true);
    const again = await svc.createOrder(prisma, input(), { ...testOrderOpts, checkoutKey: key });
    expect(again).toMatchObject({ ok: false, reason: "duplicate", order: { reference: order.reference } });
    expect((await orderOf(order.id)).checkoutKey).toBe(key);
    expect(await prisma.order.count()).toBe(1);
  });

  it("still releases the key when none of the exhausted order's attempts ever reached Paystack", async () => {
    const key = "k".repeat(64);
    const { order } = await startedOrder({ checkoutKey: key });
    await exhaust(order, false);
    const next = await svc.createOrder(prisma, input(), { ...testOrderOpts, checkoutKey: key });
    expect(next.ok).toBe(true);
    expect((await orderOf(order.id)).checkoutKey).toBeNull();
  });

  it("flags both orders when an older order is paid late after a related order was paid", async () => {
    const older = await startedOrder();
    ps.settle(older.attempt.reference, { status: "abandoned" });
    await svc.verifyAndApply(deps, older.attempt.reference);
    const newer = await startedOrder(); // the customer tried again
    ps.settle(newer.attempt.reference, { status: "success" });
    expect((await svc.verifyAndApply(deps, newer.attempt.reference)).outcome).toBe("paid");
    // Then the older page is completed after all.
    ps.settle(older.attempt.reference, { status: "success" });
    expect((await svc.verifyAndApply(deps, older.attempt.reference)).outcome).toBe("paid"); // recorded truthfully
    const [a, b] = [await orderOf(older.order.id), await orderOf(newer.order.id)];
    expect([a.status, b.status]).toEqual(["PAID", "PAID"]);
    expect(a.needsAttention).toContain("Possible duplicate purchase");
    expect(a.needsAttention).toContain(newer.order.reference);
    expect(b.needsAttention).toContain("Possible duplicate purchase");
    expect(b.needsAttention).toContain(older.order.reference);
    expect(await stock()).toBe(3); // once per paid order, never twice for one
    expect(a.notifications.map((n) => n.kind).sort()).toEqual(["ALERT_DUPLICATE_PAYMENT", "PAYMENT_RECEIPT"]); // one receipt, one owner alert each
    expect(b.notifications.map((n) => n.kind).sort()).toEqual(["ALERT_DUPLICATE_PAYMENT", "PAYMENT_RECEIPT"]);
  });

  it("flags both when related orders are confirmed at the same moment", async () => {
    const one = await startedOrder();
    const two = await startedOrder();
    ps.settle(one.attempt.reference, { status: "success" });
    ps.settle(two.attempt.reference, { status: "success" });
    await Promise.all([svc.verifyAndApply(deps, one.attempt.reference), svc.verifyAndApply(deps, two.attempt.reference)]);
    for (const [o, other] of [[one, two], [two, one]] as const) {
      const row = await orderOf(o.order.id);
      expect(row.status).toBe("PAID");
      expect(row.needsAttention).toContain(other.order.reference);
    }
    expect(await stock()).toBe(3);
  });

  it("doesn't repeat the flag on duplicate webhooks", async () => {
    const one = await startedOrder();
    const two = await startedOrder();
    for (const o of [one, two]) {
      ps.settle(o.attempt.reference, { status: "success" });
      await svc.verifyAndApply(deps, o.attempt.reference);
    }
    for (let i = 0; i < 3; i++) await svc.verifyAndApply(deps, two.attempt.reference);
    for (const o of [one, two]) {
      const notes = (await orderOf(o.order.id)).needsAttention ?? "";
      expect(notes.match(/Possible duplicate purchase/g)).toHaveLength(1);
    }
  });

  it("doesn't flag orders from different customers or for different pieces", async () => {
    const mine = await startedOrder();
    const theirs = await startedOrder({ email: "someone@example.com" });
    const created = await svc.createOrder(prisma, input("amina@example.com", [{ variantId: otherVariantId, quantity: 1 }], 100000), testOrderOpts);
    if (!created.ok) throw new Error("setup");
    await svc.initializeAttempt(deps, created.attempt.id);
    for (const ref of [mine.attempt.reference, theirs.attempt.reference, created.attempt.reference]) {
      ps.settle(ref, { status: "success" });
      await svc.verifyAndApply(deps, ref);
    }
    for (const id of [mine.order.id, theirs.order.id, created.order.id]) expect((await orderOf(id)).needsAttention).toBeNull();
  });
});
