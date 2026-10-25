import { createHmac } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import * as svc from "@/server/orders/order-service";
import { handlePaystackCallback } from "@/server/payments/callback";
import { PaystackError } from "@/server/payments/paystack";
import { handlePaystackWebhook } from "@/server/payments/webhook";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);

describe.skipIf(!hasTestDb)("Paystack webhook and callback", () => {
  const prisma = testPrisma();
  let ps: ReturnType<typeof fakePaystack>;
  let deps: svc.PaymentDeps;
  let order: { id: string; reference: string };
  let attemptRef: string;

  const sign = (body: string, key = testPaymentConfig.secretKey) => createHmac("sha512", key).update(body).digest("hex");
  const event = (reference: string, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ event: "charge.success", data: { id: 9001, status: "success", reference, amount: 380000, currency: "KES", domain: "test", ...extra } });

  beforeEach(async () => {
    await resetDb(prisma);
    ps = fakePaystack();
    deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 380000, variants: [{ size: "M", colour: "White", stock: 3 }] });
    const variantId = (await prisma.productVariant.findFirstOrThrow()).id;
    const res = await svc.createOrder(
      prisma,
      checkoutInputSchema.parse({ name: "Amina Otieno", email: "amina@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 380000 }),
      testOrderOpts,
    );
    if (!res.ok) throw new Error("setup");
    order = res.order;
    attemptRef = res.attempt.reference;
    await svc.initializeAttempt(deps, res.attempt.id);
  });
  afterAll(() => prisma.$disconnect());

  const status = async () => (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status;

  it.each([
    ["missing", null],
    ["wrong key", "sign-with-other-key"],
    ["garbage", "abc"],
  ])("rejects a %s signature without touching the database", async (_l, kind) => {
    const body = event(attemptRef);
    const sig = kind === "sign-with-other-key" ? sign(body, "sk_test_someone_else_000000") : kind;
    ps.settle(attemptRef, { status: "success" });
    expect(await handlePaystackWebhook(deps, body, sig)).toMatchObject({ status: 401 });
    expect(await prisma.webhookEvent.count()).toBe(0);
    expect(ps.verified).toHaveLength(0);
    expect(await status()).toBe("PENDING_PAYMENT");
  });

  it("never treats a signed payload as proof: it verifies with Paystack first", async () => {
    // The webhook claims success, but Paystack's verify endpoint says the payment failed.
    ps.settle(attemptRef, { status: "failed" });
    const body = event(attemptRef);
    expect(await handlePaystackWebhook(deps, body, sign(body))).toMatchObject({ status: 200, result: { outcome: "failed" } });
    expect(ps.verified).toEqual([attemptRef]);
    expect(await status()).toBe("PENDING_PAYMENT");
  });

  it("confirms payment via webhook before the customer returns; the callback then just shows it", async () => {
    ps.settle(attemptRef, { status: "success" });
    const body = event(attemptRef);
    expect(await handlePaystackWebhook(deps, body, sign(body))).toMatchObject({ status: 200, result: { outcome: "paid" } });
    expect(await status()).toBe("PAID");
    const cb = await handlePaystackCallback(deps, attemptRef);
    expect(cb.result).toMatchObject({ outcome: "already_paid" });
    expect(cb.location).toMatch(new RegExp(`^/checkout/order/${order.reference}\\?token=[A-Za-z0-9_-]{32}$`));
  });

  it("confirms payment via the callback when no webhook has arrived", async () => {
    ps.settle(attemptRef, { status: "success" });
    expect(await handlePaystackCallback(deps, attemptRef)).toMatchObject({ result: { outcome: "paid" } });
    expect(await status()).toBe("PAID");
  });

  it("acknowledges duplicate deliveries without processing them again", async () => {
    ps.settle(attemptRef, { status: "success" });
    const body = event(attemptRef);
    await handlePaystackWebhook(deps, body, sign(body));
    expect(await handlePaystackWebhook(deps, body, sign(body))).toEqual({ status: 200, body: "duplicate" });
    expect(ps.verified).toHaveLength(1);
    expect(await prisma.productVariant.findFirstOrThrow()).toMatchObject({ stock: 2 });
  });

  it("handles concurrent deliveries of the same event safely", async () => {
    ps.settle(attemptRef, { status: "success" });
    const body = event(attemptRef);
    const results = await Promise.all(Array.from({ length: 5 }, () => handlePaystackWebhook(deps, body, sign(body))));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.result?.outcome === "paid")).toHaveLength(1);
    expect(await prisma.productVariant.findFirstOrThrow()).toMatchObject({ stock: 2 });
    expect(await prisma.emailNotification.count()).toBe(1);
  });

  it("returns 500 while Paystack can't be reached, then succeeds on redelivery", async () => {
    ps.settle(attemptRef, { status: "success" });
    const body = event(attemptRef);
    ps.failVerify(new PaystackError("timeout", "timeout"));
    expect(await handlePaystackWebhook(deps, body, sign(body))).toMatchObject({ status: 500 });
    expect(await status()).toBe("PENDING_PAYMENT");
    expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({ status: "FAILED" });
    ps.failVerify(null);
    expect(await handlePaystackWebhook(deps, body, sign(body))).toMatchObject({ status: 200, result: { outcome: "paid" } });
    expect(await prisma.webhookEvent.findFirstOrThrow()).toMatchObject({ status: "PROCESSED" });
  });

  it("ignores other events and unknown references (acknowledged, nothing changed)", async () => {
    const other = JSON.stringify({ event: "transfer.success", data: { id: 1, reference: attemptRef } });
    expect(await handlePaystackWebhook(deps, other, sign(other))).toEqual({ status: 200, body: "ignored" });
    const unknown = event("SOMEONE-ELSES-REFERENCE");
    expect(await handlePaystackWebhook(deps, unknown, sign(unknown))).toEqual({ status: 200, body: "ignored" });
    expect(ps.verified).toHaveLength(0);
    expect(await status()).toBe("PENDING_PAYMENT");
  });

  it("rejects malformed JSON with a valid signature", async () => {
    expect(await handlePaystackWebhook(deps, "{not json", sign("{not json"))).toMatchObject({ status: 400 });
  });

  it("stores no raw payload or customer data from webhooks", async () => {
    ps.settle(attemptRef, { status: "success" });
    const body = event(attemptRef, { customer: { email: "amina@example.com", phone: "+254712345678" }, authorization: { last4: "4081" } });
    await handlePaystackWebhook(deps, body, sign(body));
    const stored = JSON.stringify(await prisma.webhookEvent.findMany());
    expect(stored).not.toMatch(/amina|254712345678|4081/);
  });

  it("sends unknown or malformed callback references to a neutral page", async () => {
    expect(await handlePaystackCallback(deps, null)).toEqual({ location: "/checkout/unknown" });
    expect(await handlePaystackCallback(deps, "../../admin")).toEqual({ location: "/checkout/unknown" });
    expect(await handlePaystackCallback(deps, "NOT-OURS-123")).toEqual({ location: "/checkout/unknown" });
    expect(ps.verified).toHaveLength(0);
  });

  it("shows a pending M-PESA payment as pending after the callback, then paid when the webhook arrives", async () => {
    ps.settle(attemptRef, { status: "ongoing" });
    expect(await handlePaystackCallback(deps, attemptRef)).toMatchObject({ result: { outcome: "pending" } });
    expect((await svc.getCustomerOrder(prisma, order.reference))?.state).toBe("pending");
    ps.settle(attemptRef, { status: "success" });
    const body = event(attemptRef);
    await handlePaystackWebhook(deps, body, sign(body));
    expect((await svc.getCustomerOrder(prisma, order.reference))?.state).toBe("paid");
  });
});
