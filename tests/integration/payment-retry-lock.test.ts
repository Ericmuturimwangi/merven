import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as svc from "@/server/orders/order-service";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// startNewAttempt under concurrency, against the test database with the fake
// Paystack. Two retries for one order must create and initialise at most one
// new attempt; the check-and-create is serialised by a lock on the order row.

describe.skipIf(!hasTestDb)("payment retries under concurrency", () => {
  const prisma = testPrisma();
  const observer = testPrisma(); // a separate connection pool, to watch PostgreSQL's lock waits
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let ps: ReturnType<typeof fakePaystack>;
  let deps: svc.PaymentDeps;
  let order: { id: string; reference: string };

  beforeEach(async () => {
    await resetDb(prisma);
    fetchSpy.mockClear();
    ps = fakePaystack();
    deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 250000, variants: [{ size: "M", colour: "White", stock: 5 }] });
    const variantId = (await prisma.productVariant.findFirstOrThrow()).id;
    const input = checkoutInputSchema.parse({ name: "Amina Otieno", email: "amina@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 250000 });
    const created = await svc.createOrder(prisma, input, testOrderOpts);
    if (!created.ok) throw new Error("setup");
    order = created.order;
    expect((await svc.initializeAttempt(deps, created.attempt.id)).ok).toBe(true);
    // The first attempt fails at Paystack: the order may be retried.
    ps.settle(created.attempt.reference, { status: "failed" });
    await svc.verifyAndApply(deps, created.attempt.reference);
  });
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled()); // fake Paystack only
  afterAll(async () => {
    await prisma.$disconnect();
    await observer.$disconnect();
  });

  const attempts = () => prisma.paymentAttempt.findMany({ where: { orderId: order.id }, orderBy: { createdAt: "asc" } });
  async function waitFor(check: () => Promise<boolean>, what: string) {
    for (let i = 0; i < 250; i++) {
      if (await check()) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`timed out waiting for ${what}`);
  }

  it("two simultaneous retries create one attempt and initialise it once", async () => {
    const before = ps.initialized.length;
    const [a, b] = await Promise.all([svc.startNewAttempt(deps, order.id), svc.startNewAttempt(deps, order.id)]);
    const all = await attempts();
    expect(all.map((p) => p.status)).toEqual(["FAILED", "PENDING"]); // exactly one new attempt
    expect(ps.initialized.length - before).toBe(1);
    expect(ps.initialized.at(-1)!.reference).toBe(all[1].reference); // the winner initialised its own attempt
    const winners = [a, b].filter((r) => r.ok && !r.reused);
    expect(winners).toHaveLength(1);
    const winnerUrl = winners[0].ok ? winners[0].authorizationUrl : "";
    const loser = a === winners[0] ? b : a;
    // The loser follows the existing safe responses: still confirming, or the same open checkout.
    expect(loser.ok ? loser.reused && loser.authorizationUrl === winnerUrl : loser.reason === "previous_unconfirmed").toBe(true);
  });

  it("waits for the row lock and then sees the attempt created meanwhile (deterministic)", async () => {
    let locked!: () => void;
    let release!: () => void;
    const isLocked = new Promise<void>((r) => (locked = r));
    const gate = new Promise<void>((r) => (release = r));
    // Another request holds the order row and has created an attempt, not yet committed.
    const holder = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "order" WHERE id = ${order.id} FOR UPDATE`;
        await tx.paymentAttempt.create({ data: { orderId: order.id, reference: `${order.reference}-PHELD0001`, testMode: true, amountMinor: 250000, currency: "KES" } });
        locked();
        await gate;
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
    await isLocked;
    const before = ps.initialized.length;
    const retry = svc.startNewAttempt(deps, order.id);
    // PostgreSQL itself reports the retry blocked on a lock: it can't have decided yet.
    await waitFor(async () => {
      const [row] = await observer.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`;
      return row.n >= 1;
    }, "the retry to wait on the order row lock");
    release();
    await holder;
    // After the lock, a fresh read sees the committed INITIALIZING attempt: nothing new is created or initialised.
    expect(await retry).toEqual({ ok: false, reason: "previous_unconfirmed" });
    expect(ps.initialized.length).toBe(before);
    expect((await attempts()).map((p) => p.status)).toEqual(["FAILED", "INITIALIZING"]);
  });

  it("keeps the existing response for an unconfirmed attempt (no concurrency)", async () => {
    await prisma.paymentAttempt.create({ data: { orderId: order.id, reference: `${order.reference}-PUNSURE01`, testMode: true, amountMinor: 250000, currency: "KES" } });
    const before = ps.initialized.length;
    expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "previous_unconfirmed" });
    expect(ps.initialized.length).toBe(before);
  });

  it("re-uses an open checkout instead of creating another", async () => {
    const first = await svc.startNewAttempt(deps, order.id);
    expect(first).toMatchObject({ ok: true, reused: false });
    const again = await svc.startNewAttempt(deps, order.id);
    expect(again).toEqual({ ok: true, authorizationUrl: first.ok ? first.authorizationUrl : "", reused: true });
    expect(await prisma.paymentAttempt.count({ where: { orderId: order.id } })).toBe(2);
  });

  it("never starts an attempt for an ineligible order", async () => {
    for (let i = 1; i < svc.MAX_ATTEMPTS_PER_ORDER; i++) {
      await prisma.paymentAttempt.create({ data: { orderId: order.id, reference: `${order.reference}-PUSED000${i}`, testMode: true, status: "FAILED", amountMinor: 250000, currency: "KES" } });
    }
    const before = ps.initialized.length;
    expect(await svc.startNewAttempt(deps, order.id)).toEqual({ ok: false, reason: "too_many_attempts" });
    await prisma.order.update({ where: { id: order.id }, data: { status: "PAID", paidAt: new Date() } });
    expect(await svc.startNewAttempt(deps, order.id)).toMatchObject({ ok: false, reason: "already_paid" });
    expect(ps.initialized.length).toBe(before);
    expect(await prisma.paymentAttempt.count({ where: { orderId: order.id } })).toBe(svc.MAX_ATTEMPTS_PER_ORDER);
  });
});
