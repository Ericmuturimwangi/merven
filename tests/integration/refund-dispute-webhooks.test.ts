import { createHmac } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as svc from "@/server/orders/order-service";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import { ALERT_KINDS } from "@/server/notifications/owner-alerts";
import { handlePaystackWebhook } from "@/server/payments/webhook";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Refund and dispute webhooks (event names from Paystack's webhook and refund
// documentation). They are recorded and brought to the owner's attention, and
// never change order status, payment status or stock. Signed with the test key;
// the fake Paystack is used and no network call is made.

describe.skipIf(!hasTestDb)("refund and dispute webhooks", () => {
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
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 250000, variants: [{ size: "M", colour: "White", stock: 5 }] });
    variantId = (await prisma.productVariant.findFirstOrThrow()).id;
  });
  afterEach(() => expect(fetchSpy).not.toHaveBeenCalled());
  afterAll(() => prisma.$disconnect());

  const sign = (body: string) => createHmac("sha512", testPaymentConfig.secretKey).update(body).digest("hex");
  const deliver = (payload: object) => {
    const body = JSON.stringify(payload);
    return handlePaystackWebhook(deps, body, sign(body));
  };
  async function paidOrder() {
    const input = checkoutInputSchema.parse({ name: "Amina Secretname", email: "amina.secret@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 250000 });
    const created = await svc.createOrder(prisma, input, testOrderOpts);
    if (!created.ok) throw new Error("setup");
    await svc.initializeAttempt(deps, created.attempt.id);
    ps.settle(created.attempt.reference, { status: "success" });
    await svc.verifyAndApply(deps, created.attempt.reference);
    return created;
  }
  // Shaped like Paystack's documented refund webhook payload (customer details included, to prove they're dropped).
  const refundEvent = (reference: string, status: string, refundReference: string | null = null) => ({
    event: `refund.${status}`,
    data: {
      status,
      transaction_reference: reference,
      refund_reference: refundReference,
      amount: "250000",
      currency: "KES",
      processor: "mpesa",
      customer: { first_name: "Amina", last_name: "Secretname", email: "amina.secret@example.com" },
      integration: 123,
      domain: "test",
    },
  });
  const orderOf = (id: string) => prisma.order.findUniqueOrThrow({ where: { id }, include: { payments: true } });
  const alertKinds = async (orderId: string) => (await prisma.emailNotification.findMany({ where: { orderId, kind: { startsWith: "ALERT_" } } })).map((a) => a.kind);
  const stock = async () => (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock;
  const PII = /Amina|Secretname|amina\.secret/;

  it("records a refund on the order and alerts the owner, without un-paying it", async () => {
    const { order, attempt } = await paidOrder();
    const res = await deliver(refundEvent(attempt.reference, "processed"));
    expect(res).toMatchObject({ status: 200, body: "ok", result: { outcome: "needs_attention", orderId: order.id } });
    const after = await orderOf(order.id);
    expect(after).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED" });
    expect(after.payments[0].status).toBe("SUCCESS");
    expect(after.needsAttention).toMatch(/^\d{4}-\d{2}-\d{2}: Paystack reported a refund \(refund\.processed, status processed\) on payment TEST-MRV-[0-9A-Z-]+, amount 250000 KES as Paystack reported it \(smallest currency unit\)\. Order and payment status are unchanged/m);
    expect(await alertKinds(order.id)).toEqual([`${ALERT_KINDS.refund}:${attempt.reference}:amount-250000:reported`]);
    expect(await stock()).toBe(4); // untouched by the refund
    expect(ps.verified).toEqual([attempt.reference]); // only the original charge was verified
  });

  it("follows a refund through its stages: one alert, one note per stage, duplicates ignored", async () => {
    const { order, attempt } = await paidOrder();
    for (const status of ["pending", "processing", "processed"]) expect((await deliver(refundEvent(attempt.reference, status))).status).toBe(200);
    expect(await deliver(refundEvent(attempt.reference, "processed"))).toEqual({ status: 200, body: "duplicate" });
    const notes = (await orderOf(order.id)).needsAttention ?? "";
    expect(notes.match(/Paystack reported a refund/g)).toHaveLength(3);
    expect(await alertKinds(order.id)).toEqual([`${ALERT_KINDS.refund}:${attempt.reference}:amount-250000:reported`]);
  });

  it("alerts again when a refund fails or needs attention, once each", async () => {
    const { order, attempt } = await paidOrder();
    for (const status of ["pending", "failed", "failed", "needs-attention"]) await deliver(refundEvent(attempt.reference, status));
    expect((await alertKinds(order.id)).sort()).toEqual(
      ["failed", "needs-attention", "reported"].map((stage) => `${ALERT_KINDS.refund}:${attempt.reference}:amount-250000:${stage}`),
    );
    const after = await orderOf(order.id);
    expect(after).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED" });
    expect(after.payments[0].status).toBe("SUCCESS");
  });

  it("keeps two partial refunds without a refund reference apart (different amounts)", async () => {
    const { order, attempt } = await paidOrder();
    const partial = (amount: string) => {
      const e = refundEvent(attempt.reference, "processed");
      return { ...e, data: { ...e.data, amount } };
    };
    expect((await deliver(partial("100000"))).body).toBe("ok");
    expect((await deliver(partial("150000"))).body).toBe("ok");
    expect(await deliver(partial("150000"))).toEqual({ status: 200, body: "duplicate" }); // a redelivery
    expect(await prisma.webhookEvent.count({ where: { event: "refund.processed", status: "PROCESSED" } })).toBe(2);
    const notes = (await orderOf(order.id)).needsAttention ?? "";
    expect(notes).toContain("amount 100000 KES");
    expect(notes).toContain("amount 150000 KES");
    expect((await alertKinds(order.id)).sort()).toEqual([
      `${ALERT_KINDS.refund}:${attempt.reference}:amount-100000:reported`,
      `${ALERT_KINDS.refund}:${attempt.reference}:amount-150000:reported`,
    ]);
    expect(await stock()).toBe(4);
  });

  it("handles concurrent deliveries of one refund event: one note, one alert, no errors", async () => {
    const { order, attempt } = await paidOrder();
    const results = await Promise.all(Array.from({ length: 5 }, () => deliver(refundEvent(attempt.reference, "processed", "RF-0009"))));
    for (const r of results) expect(r.status).toBe(200);
    expect(((await orderOf(order.id)).needsAttention ?? "").match(/Paystack reported a refund/g)).toHaveLength(1);
    expect(await alertKinds(order.id)).toEqual([`${ALERT_KINDS.refund}:${attempt.reference}:ref-RF-0009:reported`]);
  });

  it("validates optional refund fields: a malformed amount or reference is ignored, never stored", async () => {
    const { order, attempt } = await paidOrder();
    const e = refundEvent(attempt.reference, "processed");
    expect((await deliver({ ...e, data: { ...e.data, amount: "12abc", refund_reference: "<script>" } })).body).toBe("ok");
    const notes = (await orderOf(order.id)).needsAttention ?? "";
    expect(notes).not.toContain("12abc");
    expect(notes).not.toContain("<script>");
    expect(await alertKinds(order.id)).toEqual([`${ALERT_KINDS.refund}:${attempt.reference}:amount-unknown:reported`]);
  });

  it("treats two different refunds on one payment as two events", async () => {
    const { order, attempt } = await paidOrder();
    await deliver(refundEvent(attempt.reference, "processed", "RF-0001"));
    expect((await deliver(refundEvent(attempt.reference, "processed", "RF-0002"))).body).toBe("ok");
    expect(await prisma.webhookEvent.count({ where: { event: "refund.processed", status: "PROCESSED" } })).toBe(2);
    expect((await orderOf(order.id)).status).toBe("PAID");
  });

  it("records a dispute when its payload names one of our payments", async () => {
    const { order, attempt } = await paidOrder();
    const res = await deliver({ event: "charge.dispute.create", data: { id: 777, status: "awaiting-merchant-feedback", transaction: { reference: attempt.reference, amount: 250000 }, currency: "KES" } });
    expect(res.body).toBe("ok");
    const after = await orderOf(order.id);
    expect(after.status).toBe("PAID");
    expect(after.needsAttention).toContain("Paystack reported a dispute (charge.dispute.create, status awaiting-merchant-feedback) on payment");
    expect(after.needsAttention).toContain("(dispute 777)");
    expect(await alertKinds(order.id)).toEqual([`${ALERT_KINDS.dispute}:${attempt.reference}:dispute-777:opened`]);
  });

  describe("dispute lifecycle", () => {
    afterEach(() => vi.useRealTimers());
    const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
    const dispute = (event: string, reference: string, extra: Record<string, unknown> = {}) => ({
      event,
      data: { id: 777, status: "awaiting-merchant-feedback", transaction: { reference }, ...extra },
    });

    it("alerts when opened, at most once a day for reminders, and when resolved", async () => {
      const { order, attempt } = await paidOrder();
      at("2026-10-25T08:00:00Z");
      await deliver(dispute("charge.dispute.create", attempt.reference));
      // Reminders every 4 hours (some with changed fields): one reminder alert that day.
      await deliver(dispute("charge.dispute.remind", attempt.reference));
      at("2026-10-25T12:00:00Z");
      expect(await deliver(dispute("charge.dispute.remind", attempt.reference))).toEqual({ status: 200, body: "duplicate" });
      await deliver(dispute("charge.dispute.remind", attempt.reference, { updatedAt: "2026-10-25T12:00:00Z" }));
      at("2026-10-26T08:00:00Z");
      await deliver(dispute("charge.dispute.remind", attempt.reference, { updatedAt: "2026-10-26T08:00:00Z" }));
      await deliver(dispute("charge.dispute.resolve", attempt.reference, { status: "resolved" }));
      expect((await alertKinds(order.id)).sort()).toEqual(
        ["opened", "reminder-2026-10-25", "reminder-2026-10-26", "resolved"].map((stage) => `${ALERT_KINDS.dispute}:${attempt.reference}:dispute-777:${stage}`).sort(),
      );
      const after = await orderOf(order.id);
      expect(after).toMatchObject({ status: "PAID", stockStatus: "DEDUCTED" });
      expect(after.payments[0].status).toBe("SUCCESS");
      expect(await stock()).toBe(4);
    });

    it("tells two disputes on one payment apart by id, and copes without one", async () => {
      const { order, attempt } = await paidOrder();
      await deliver(dispute("charge.dispute.create", attempt.reference));
      await deliver(dispute("charge.dispute.create", attempt.reference, { id: 778 }));
      await deliver(dispute("charge.dispute.create", attempt.reference, { id: { nested: "not-an-id" } }));
      expect((await alertKinds(order.id)).sort()).toEqual(
        ["dispute-777", "dispute-778", "dispute"].map((d) => `${ALERT_KINDS.dispute}:${attempt.reference}:${d}:opened`).sort(),
      );
    });
  });

  it("acknowledges but links nothing when the payment isn't ours or can't be identified", async () => {
    await paidOrder();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(await deliver(refundEvent("TEST-MRV-NOTOURS0000-PXXXXXXXX", "processed"))).toEqual({ status: 200, body: "ignored" });
      expect(await deliver({ event: "charge.dispute.create", data: { id: 1, status: "awaiting-merchant-feedback" } })).toEqual({ status: 200, body: "ignored" });
      expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
        JSON.stringify({ level: "warn", event: "webhook_follow_up_unmatched", paystackEvent: "refund.processed" }),
        JSON.stringify({ level: "warn", event: "webhook_follow_up_unmatched", paystackEvent: "charge.dispute.create" }),
      ]);
    } finally {
      warn.mockRestore();
    }
    expect(await prisma.emailNotification.count({ where: { kind: { startsWith: "ALERT_" } } })).toBe(0);
  });

  it("ignores a live-mode event for a test payment", async () => {
    const { order, attempt } = await paidOrder();
    const liveDeps = { ...deps, config: { ...testPaymentConfig, mode: "live" as const, environment: "production" as const, testDatabaseToken: null } };
    const body = JSON.stringify(refundEvent(attempt.reference, "processed"));
    expect(await handlePaystackWebhook(liveDeps, body, sign(body))).toEqual({ status: 200, body: "ignored" });
    expect((await orderOf(order.id)).needsAttention).toBeNull();
  });

  it("refuses unsigned or wrongly signed refund events", async () => {
    const { order, attempt } = await paidOrder();
    const body = JSON.stringify(refundEvent(attempt.reference, "processed"));
    expect(await handlePaystackWebhook(deps, body, null)).toEqual({ status: 401, body: "invalid signature" });
    expect(await handlePaystackWebhook(deps, body, "0".repeat(128))).toEqual({ status: 401, body: "invalid signature" });
    expect((await orderOf(order.id)).needsAttention).toBeNull();
  });

  it("never stores the customer details a refund payload carries", async () => {
    const { order, attempt } = await paidOrder();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      await deliver(refundEvent(attempt.reference, "processed"));
      expect(info.mock.calls.map((c) => String(c[0])).join("\n")).not.toMatch(PII);
    } finally {
      info.mockRestore();
    }
    expect((await orderOf(order.id)).needsAttention).not.toMatch(PII);
    expect(JSON.stringify(await prisma.webhookEvent.findMany())).not.toMatch(PII);
  });
});
