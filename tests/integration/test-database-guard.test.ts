import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import * as svc from "@/server/orders/order-service";
import { testDatabaseApproved } from "@/server/payments/test-database";
import { handlePaystackWebhook } from "@/server/payments/webhook";
import { createHmac } from "node:crypto";
import { fakePaystack, TEST_DB_TOKEN, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// M2: test-mode orders and payments may only write to a database that carries
// the test-payments marker matching the configured token. Runs against the
// isolated test database; the marker is removed and restored around tests.

describe.skipIf(!hasTestDb)("test-database safeguard", () => {
  const prisma = testPrisma();
  let ps: ReturnType<typeof fakePaystack>;
  let variantId: string;

  const setMarker = (value: string | null) =>
    prisma.$executeRawUnsafe(
      `DO $$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), ${value === null ? "NULL::text" : `'${value}'`}); END $$;`,
    );
  const input = () =>
    checkoutInputSchema.parse({ name: "Amina Otieno", email: "amina@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 380000 });
  const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;

  beforeEach(async () => {
    await resetDb(prisma);
    ps = fakePaystack();
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 380000, variants: [{ size: "M", colour: "White", stock: 3 }] });
    variantId = (await prisma.productVariant.findFirstOrThrow()).id;
  });
  afterEach(async () => {
    await setMarker(`merven-test-payments:${TEST_DB_TOKEN}`); // always restore
  });
  afterAll(() => prisma.$disconnect());

  it("recognises only the exact marker for the configured token", async () => {
    expect(await testDatabaseApproved(prisma, TEST_DB_TOKEN)).toBe(true);
    expect(await testDatabaseApproved(prisma, `${TEST_DB_TOKEN}x`)).toBe(false);
    expect(await testDatabaseApproved(prisma, TEST_DB_TOKEN.slice(0, -1))).toBe(false);
    expect(await testDatabaseApproved(prisma, null)).toBe(false);
    expect(await testDatabaseApproved(prisma, "")).toBe(false);
  });

  it.each([
    ["no marker on the database", null],
    ["a marker for a different token", "merven-test-payments:some-other-database-token"],
    ["a comment that merely mentions test", "merven test database (dev)"],
  ])("refuses everything with %s", async (_l, marker) => {
    await setMarker(marker);
    expect(await testDatabaseApproved(prisma, TEST_DB_TOKEN)).toBe(false);
    expect(await svc.createOrder(prisma, input(), testOrderOpts)).toEqual({ ok: false, reason: "test_database_not_approved" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("refuses to create a test order with a missing or wrong token", async () => {
    expect(await svc.createOrder(prisma, input(), { testMode: true })).toEqual({ ok: false, reason: "test_database_not_approved" });
    expect(await svc.createOrder(prisma, input(), { testMode: true, testDatabaseToken: "wrong-token-but-long-enough" })).toMatchObject({ reason: "test_database_not_approved" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("refuses to initialise a test payment when the database is not approved", async () => {
    const res = await svc.createOrder(prisma, input(), testOrderOpts);
    if (!res.ok) throw new Error("setup");
    await setMarker(null);
    const deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    expect(await svc.initializeAttempt(deps, res.attempt.id)).toEqual({ ok: false, reason: "test_database_not_approved" });
    expect(ps.initialized).toHaveLength(0);
  });

  it("never deducts stock, marks paid or queues a receipt for a verified test payment without approval", async () => {
    const deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const res = await svc.createOrder(prisma, input(), testOrderOpts);
    if (!res.ok) throw new Error("setup");
    await svc.initializeAttempt(deps, res.attempt.id);
    ps.settle(res.attempt.reference, { status: "success" });

    // Database approval withdrawn between checkout and confirmation.
    await setMarker(null);
    expect(await svc.verifyAndApply(deps, res.attempt.reference)).toMatchObject({ outcome: "test_database_not_approved", stockChanged: false, receiptQueued: false });
    // A wrong token is refused too, even with the marker present.
    await setMarker(`merven-test-payments:${TEST_DB_TOKEN}`);
    const wrong = { ...deps, config: { ...testPaymentConfig, testDatabaseToken: "another-database-token-000" } };
    expect(await svc.verifyAndApply(wrong, res.attempt.reference)).toMatchObject({ outcome: "test_database_not_approved" });

    const order = await prisma.order.findUniqueOrThrow({ where: { id: res.order.id }, include: { payments: true, notifications: true } });
    expect(order).toMatchObject({ status: "PENDING_PAYMENT", stockStatus: "NOT_APPLIED", needsAttention: null });
    expect(order.payments[0].status).toBe("PENDING");
    expect(order.notifications).toHaveLength(0);
    expect(await stock()).toBe(3);

    // Once approved again, the same payment is applied exactly once.
    expect(await svc.verifyAndApply(deps, res.attempt.reference)).toMatchObject({ outcome: "paid" });
    expect(await svc.verifyAndApply(deps, res.attempt.reference)).toMatchObject({ outcome: "already_paid" });
    expect(await stock()).toBe(2);
  });

  it("makes the webhook retryable (not processed) while the database is not approved", async () => {
    const deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const res = await svc.createOrder(prisma, input(), testOrderOpts);
    if (!res.ok) throw new Error("setup");
    await svc.initializeAttempt(deps, res.attempt.id);
    ps.settle(res.attempt.reference, { status: "success" });
    await setMarker(null);
    const body = JSON.stringify({ event: "charge.success", data: { id: 77, status: "success", reference: res.attempt.reference } });
    const sig = createHmac("sha512", testPaymentConfig.secretKey).update(body).digest("hex");
    expect(await handlePaystackWebhook(deps, body, sig)).toMatchObject({ status: 503 });
    expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({ status: "FAILED" });
    expect(await stock()).toBe(3);
    await setMarker(`merven-test-payments:${TEST_DB_TOKEN}`);
    expect(await handlePaystackWebhook(deps, body, sig)).toMatchObject({ status: 200, result: { outcome: "paid" } });
    expect(await stock()).toBe(2);
  });
});
