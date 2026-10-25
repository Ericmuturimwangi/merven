import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as svc from "@/server/orders/order-service";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import { MailerError, type Mailer, type OutgoingEmail } from "@/server/notifications/mailer";
import { ALERT_KINDS, processOwnerAlerts } from "@/server/notifications/owner-alerts";
import { processReceipts } from "@/server/notifications/receipts";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Owner alerts for orders that need a person, with a fake mailer (no email is
// sent) and the fake Paystack. One alert per order and kind, however many
// confirmations arrive; no customer details in the message.

vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {}, updateTag: () => {} }));

const SITE = "https://mervenfashions.co.ke";
const OWNER = "owner@example.com";

function fakeMailer(fail: MailerError | null = null) {
  const sent: (OutgoingEmail & { at: number })[] = [];
  const mailer: Mailer = {
    name: "fake",
    async send(email) {
      if (fail) throw fail;
      sent.push({ ...email, at: sent.length });
      return { messageId: `m-${sent.length}` };
    },
  };
  return { mailer, sent };
}

describe.skipIf(!hasTestDb)("owner alerts", () => {
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
  afterEach(() => {
    vi.unstubAllEnvs();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  afterAll(() => prisma.$disconnect());

  const input = () => checkoutInputSchema.parse({ name: "Amina Secretname", email: "amina.secret@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 250000 });
  async function paidOrder() {
    const created = await svc.createOrder(prisma, input(), testOrderOpts);
    if (!created.ok) throw new Error("setup");
    await svc.initializeAttempt(deps, created.attempt.id);
    ps.settle(created.attempt.reference, { status: "success" });
    await svc.verifyAndApply(deps, created.attempt.reference);
    return created;
  }
  const alerts = (orderId?: string) => prisma.emailNotification.findMany({ where: { kind: { startsWith: "ALERT_" }, ...(orderId ? { orderId } : {}) }, orderBy: { createdAt: "asc" } });
  const PII = /Amina|Secretname|amina\.secret|712345678|\+254/;

  it("queues one stock-shortfall alert in the same transaction as the payment", async () => {
    const created = await svc.createOrder(prisma, input(), testOrderOpts);
    if (!created.ok) throw new Error("setup");
    await svc.initializeAttempt(deps, created.attempt.id);
    await prisma.productVariant.update({ where: { id: variantId }, data: { stock: 0 } });
    ps.settle(created.attempt.reference, { status: "success" });
    for (let i = 0; i < 3; i++) await svc.verifyAndApply(deps, created.attempt.reference); // repeated confirmations
    expect((await alerts(created.order.id)).map((a) => a.kind)).toEqual([ALERT_KINDS.stockShortfall]);
  });

  it("queues one duplicate-payment alert per order for a possible duplicate purchase", async () => {
    const one = await paidOrder();
    const two = await paidOrder();
    for (let i = 0; i < 3; i++) await svc.verifyAndApply(deps, two.attempt.reference);
    expect((await alerts(one.order.id)).map((a) => a.kind)).toEqual([ALERT_KINDS.duplicatePayment]);
    expect((await alerts(two.order.id)).map((a) => a.kind)).toEqual([ALERT_KINDS.duplicatePayment]);
  });

  it("queues a duplicate-payment alert for a second payment on the same order", async () => {
    const created = await paidOrder();
    await prisma.paymentAttempt.update({ where: { id: created.attempt.id }, data: { status: "FAILED" } }); // pretend the first attempt was failed when the customer retried
    const second = await prisma.paymentAttempt.create({ data: { orderId: created.order.id, reference: `${created.order.reference}-P2NDTRY01`, testMode: true, amountMinor: 250000, currency: "KES" } });
    await svc.initializeAttempt(deps, second.id).catch(() => null);
    ps.create(second.reference, 250000, "success");
    expect((await svc.verifyAndApply(deps, second.reference)).outcome).toBe("duplicate_payment");
    expect((await alerts(created.order.id)).map((a) => a.kind)).toEqual([ALERT_KINDS.duplicatePayment]);
  });

  it("sends each alert once to the owner, with no customer details", async () => {
    await paidOrder();
    await paidOrder();
    const { mailer, sent } = fakeMailer();
    const first = await processOwnerAlerts(prisma, mailer, { siteUrl: SITE, ownerEmail: OWNER });
    expect(first).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    const again = await processOwnerAlerts(prisma, mailer, { siteUrl: SITE, ownerEmail: OWNER }); // a repeated cron run
    expect(again).toMatchObject({ claimed: 0, sent: 0 });
    expect(sent).toHaveLength(2);
    for (const m of sent) {
      expect(m.to).toBe(OWNER);
      expect(m.subject).toMatch(/^\[TEST\] Merven order TEST-MRV-[0-9A-Z]{10}: possible duplicate payment$/);
      expect(m.text).toMatch(new RegExp(`${SITE}/admin/orders/c[a-z0-9]+`));
      expect(`${m.subject}\n${m.text}\n${m.html}`).not.toMatch(PII);
      expect(m.idempotencyKey).toMatch(/^alert-/);
    }
    expect((await alerts()).every((a) => a.status === "SENT")).toBe(true);
  });

  it("keeps alerts queued when no mailer or owner address is configured", async () => {
    await paidOrder();
    await paidOrder();
    expect(await processOwnerAlerts(prisma, null, { siteUrl: SITE, ownerEmail: OWNER })).toMatchObject({ sent: 0, skipped: "Email provider not configured" });
    expect(await processOwnerAlerts(prisma, fakeMailer().mailer, { siteUrl: SITE, ownerEmail: null })).toMatchObject({ sent: 0, skipped: "OWNER_ALERT_EMAIL not configured" });
    expect((await alerts()).every((a) => a.status === "PENDING" && a.attempts === 0)).toBe(true);
  });

  it("retries a temporary failure later and gives up after a permanent one", async () => {
    await paidOrder();
    await paidOrder();
    const t0 = new Date();
    expect(await processOwnerAlerts(prisma, fakeMailer(new MailerError("busy", true)).mailer, { siteUrl: SITE, ownerEmail: OWNER, limit: 1, now: () => t0 })).toMatchObject({ failed: 1 });
    expect(await processOwnerAlerts(prisma, fakeMailer(new MailerError("rejected", false)).mailer, { siteUrl: SITE, ownerEmail: OWNER, limit: 1, now: () => t0 })).toMatchObject({ failed: 1 });
    const rows = await alerts();
    expect(rows.map((r) => r.status).sort()).toEqual(["FAILED", "PENDING"]);
    const pending = rows.find((r) => r.status === "PENDING")!;
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(t0.getTime()); // backed off
  });

  it("keeps receipts and alerts apart: receipts never go to the owner, alerts never to the customer", async () => {
    await paidOrder();
    await paidOrder();
    const { mailer, sent } = fakeMailer();
    await processReceipts(prisma, mailer, { siteUrl: SITE });
    expect(sent.map((m) => m.to)).toEqual(["amina.secret@example.com", "amina.secret@example.com"]); // the two receipts
    sent.length = 0;
    await processOwnerAlerts(prisma, mailer, { siteUrl: SITE, ownerEmail: OWNER });
    expect(sent.map((m) => m.to)).toEqual([OWNER, OWNER]);
  });

  describe("cron route", () => {
    const route = () => import("@/app/api/cron/receipts/route");
    const call = async (auth?: string) => (await route()).GET(new Request(`${SITE}/api/cron/receipts`, { headers: auth ? { authorization: auth } : {} }));

    it("is off without a CRON_SECRET of at least 16 characters", async () => {
      vi.stubEnv("CRON_SECRET", "");
      expect((await call("Bearer ")).status).toBe(503);
      vi.stubEnv("CRON_SECRET", "too-short");
      expect((await call("Bearer too-short")).status).toBe(503);
    });

    it("refuses a missing or wrong secret", async () => {
      vi.stubEnv("CRON_SECRET", "a-long-cron-secret-for-tests");
      expect((await call()).status).toBe(401);
      expect((await call("Bearer a-long-cron-secret-for-testX")).status).toBe(401);
      expect((await call("a-long-cron-secret-for-tests")).status).toBe(401);
    });

    it("processes receipts and alerts with the right secret, reporting both", async () => {
      vi.stubEnv("CRON_SECRET", "a-long-cron-secret-for-tests");
      vi.stubEnv("EMAIL_PROVIDER", "");
      vi.stubEnv("PAYMENTS_ENABLED", "false"); // never a real Paystack client in tests
      const res = await call("Bearer a-long-cron-secret-for-tests");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        claimed: 0,
        sent: 0,
        failed: 0,
        skipped: "Email provider not configured",
        alerts: { claimed: 0, sent: 0, failed: 0, skipped: "Email provider not configured" },
        // Payment recovery is fail-closed: skipped while payments are disabled.
        recovery: { disabled: "payments disabled" },
      });
    });
  });
});
