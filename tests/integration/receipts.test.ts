import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import * as svc from "@/server/orders/order-service";
import { MailerError, type Mailer, type OutgoingEmail } from "@/server/notifications/mailer";
import { MAX_RECEIPT_ATTEMPTS, processReceipts, requeueReceipt } from "@/server/notifications/receipts";
import { fakePaystack, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

const SITE = "http://localhost:3000";

function recordingMailer(fail: () => Error | null = () => null) {
  const sent: OutgoingEmail[] = [];
  const mailer: Mailer = {
    name: "test",
    async send(email) {
      const e = fail();
      if (e) throw e;
      sent.push(email);
      return { messageId: `msg-${sent.length}` };
    },
  };
  return { mailer, sent };
}

describe.skipIf(!hasTestDb)("payment receipts", () => {
  const prisma = testPrisma();
  let orderId: string;
  let orderRef: string;

  beforeEach(async () => {
    await resetDb(prisma);
    const ps = fakePaystack();
    const deps = { prisma, paystack: ps.client, config: testPaymentConfig };
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 380000, variants: [{ size: "M", colour: "White", stock: 3 }] });
    const variantId = (await prisma.productVariant.findFirstOrThrow()).id;
    const res = await svc.createOrder(
      prisma,
      checkoutInputSchema.parse({ name: "Amina <b>Otieno</b>", email: "amina@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 380000 }),
      testOrderOpts,
    );
    if (!res.ok) throw new Error("setup");
    orderId = res.order.id;
    orderRef = res.order.reference;
    await svc.initializeAttempt(deps, res.attempt.id);
    ps.settle(res.attempt.reference, { status: "success" });
    await svc.verifyAndApply(deps, res.attempt.reference);
  });
  afterAll(() => prisma.$disconnect());

  const receipt = () => prisma.emailNotification.findFirstOrThrow({ where: { orderId } });
  const order = () => prisma.order.findUniqueOrThrow({ where: { id: orderId } });

  it("sends one branded receipt with the confirmed details, and never again", async () => {
    const { mailer, sent } = recordingMailer();
    expect(await processReceipts(prisma, mailer, { siteUrl: SITE })).toMatchObject({ sent: 1 });
    expect(await processReceipts(prisma, mailer, { siteUrl: SITE })).toMatchObject({ claimed: 0, sent: 0 });
    expect(sent).toHaveLength(1);
    const email = sent[0];
    expect(email.to).toBe("amina@example.com");
    expect(email.subject).toBe(`[TEST] Your Merven Fashions receipt — order ${orderRef}`);
    expect(email.text).toMatch(/TEST MODE: no real money was taken/);
    expect(email.text).toMatch(/Payment method: M-PESA \(mobile money\)/);
    expect(email.text).toMatch(/1 × tie dress \(White, M\) @ KES 3,800 = KES 3,800/);
    expect(email.text).toMatch(/Amount paid: KES 3,800 \(KES\)/);
    expect(email.text).toMatch(/Delivery is not included in this payment and has not been arranged yet/);
    expect(email.text).toContain(`${SITE}/checkout/order/${orderRef}?token=`);
    expect(email.html).toContain("Amina &lt;b&gt;Otieno&lt;/b&gt;"); // escaped, never injected
    expect(email.html).not.toMatch(/sk_test_|password/i);
    expect(email.idempotencyKey).toBe(`receipt-${(await receipt()).id}`);
    expect(await receipt()).toMatchObject({ status: "SENT", attempts: 1, providerMessageId: "msg-1" });
  });

  it("keeps the order paid when email fails, and retries later with backoff", async () => {
    let failing = true;
    const { mailer, sent } = recordingMailer(() => (failing ? new MailerError("HTTP 503", true) : null));
    expect(await processReceipts(prisma, mailer, { siteUrl: SITE })).toMatchObject({ failed: 1 });
    const r = await receipt();
    expect(r).toMatchObject({ status: "PENDING", attempts: 1, lastError: "HTTP 503" });
    expect(r.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(await order()).toMatchObject({ status: "PAID" });

    // Not due yet: nothing happens.
    expect(await processReceipts(prisma, mailer, { siteUrl: SITE })).toMatchObject({ claimed: 0 });
    // Once due, it sends.
    failing = false;
    const later = () => new Date(Date.now() + 3_600_000);
    expect(await processReceipts(prisma, mailer, { siteUrl: SITE, now: later })).toMatchObject({ sent: 1 });
    expect(sent).toHaveLength(1);
  });

  it("gives up after the maximum attempts (visible as FAILED) and can be requeued by an admin", async () => {
    const { mailer } = recordingMailer(() => new MailerError("HTTP 500", true));
    let t = Date.now();
    for (let i = 0; i < MAX_RECEIPT_ATTEMPTS + 2; i++) {
      t += 24 * 3_600_000;
      await processReceipts(prisma, mailer, { siteUrl: SITE, now: () => new Date(t) });
    }
    expect(await receipt()).toMatchObject({ status: "FAILED", attempts: MAX_RECEIPT_ATTEMPTS });
    expect(await order()).toMatchObject({ status: "PAID" });
    await requeueReceipt(prisma, orderId);
    expect(await receipt()).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("stops at once for a permanent error (e.g. a rejected address)", async () => {
    const { mailer } = recordingMailer(() => new MailerError("HTTP 422", false));
    await processReceipts(prisma, mailer, { siteUrl: SITE });
    expect(await receipt()).toMatchObject({ status: "FAILED", attempts: 1 });
  });

  it("leaves receipts queued (not failed) when no email provider is configured", async () => {
    expect(await processReceipts(prisma, null, { siteUrl: SITE })).toMatchObject({ skipped: "Email provider not configured" });
    expect(await receipt()).toMatchObject({ status: "PENDING", attempts: 0 });
  });

  it("never sends a receipt for an order that is not paid", async () => {
    await prisma.order.update({ where: { id: orderId }, data: { status: "PENDING_PAYMENT", paidAt: null } });
    const { mailer, sent } = recordingMailer();
    await processReceipts(prisma, mailer, { siteUrl: SITE });
    expect(sent).toHaveLength(0);
  });

  it("lets only one of several concurrent workers send", async () => {
    const { mailer, sent } = recordingMailer();
    await Promise.all(Array.from({ length: 5 }, () => processReceipts(prisma, mailer, { siteUrl: SITE })));
    expect(sent).toHaveLength(1);
  });

  it("recovers a receipt stuck mid-send after a crash", async () => {
    await prisma.emailNotification.updateMany({ where: { orderId }, data: { status: "SENDING", attempts: 1, lockedAt: new Date(Date.now() - 60 * 60_000) } });
    const { mailer, sent } = recordingMailer();
    await processReceipts(prisma, mailer, { siteUrl: SITE });
    expect(sent).toHaveLength(1);
    expect(await receipt()).toMatchObject({ status: "SENT", attempts: 2 });
  });
});
