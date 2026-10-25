import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePaystack, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// The public checkout server actions, end to end against the test database
// with a fake Paystack. Payments are toggled through the mocked runtime.

process.env.BETTER_AUTH_SECRET ??= "x".repeat(40);

const h = vi.hoisted(() => ({ enabled: true, ps: null as null | ReturnType<typeof import("../support/fake-paystack").fakePaystack>, ip: "198.51.100.7" }));

vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": h.ip }) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ updateTag: () => {}, refresh: () => {}, revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} }));
vi.mock("next/server", () => ({ after: () => {} }));
vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("@/server/payments/runtime", async () => {
  const { testPrisma } = await import("../support/db");
  return {
    paymentDeps: () => (h.enabled && h.ps ? { prisma: testPrisma(), paystack: h.ps.client, config: testPaymentConfig } : null),
    afterPaymentChange: async () => {},
  };
});

const actions = await import("@/server/checkout/actions");
const { orderAccessToken } = await import("@/server/orders/access");

describe.skipIf(!hasTestDb)("checkout server actions", () => {
  const prisma = testPrisma();
  let variantId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    h.enabled = true;
    h.ps = fakePaystack();
    h.ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 380000, variants: [{ size: "M", colour: "White", stock: 3 }] });
    variantId = (await prisma.productVariant.findFirstOrThrow()).id;
  });
  afterAll(() => prisma.$disconnect());

  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };
  const checkout = (overrides: Record<string, string> = {}) =>
    form({ name: "Amina Otieno", email: "amina@example.com", phone: "0712345678", items: `${variantId}:1`, expectedTotalMinor: "380000", ...overrides });

  it("creates the order and sends the customer to Paystack's checkout", async () => {
    await expect(actions.startCheckoutAction({ ok: false }, checkout())).rejects.toMatchObject({ url: expect.stringMatching(/^https:\/\/checkout\.paystack\.com\//) });
    const order = await prisma.order.findFirstOrThrow({ include: { payments: true } });
    expect(order).toMatchObject({ status: "PENDING_PAYMENT", totalMinor: 380000, testMode: true });
    expect(h.ps!.initialized[0].amountMinor).toBe(380000);
  });

  it("ignores a tampered price: the customer is sent back to review", async () => {
    const res = await actions.startCheckoutAction({ ok: false }, checkout({ expectedTotalMinor: "100" }));
    expect(res).toMatchObject({ ok: false, reviewAgain: true });
    expect(await prisma.order.count()).toBe(0);
    expect(h.ps!.initialized).toHaveLength(0);
  });

  it("validates contact details on the server", async () => {
    const res = await actions.startCheckoutAction({ ok: false }, checkout({ email: "nope", phone: "123" }));
    expect(res.errors).toMatchObject({ email: expect.any(Array), phone: expect.any(Array) });
    // Typed values come back so the form can refill after React resets it.
    expect(res.values).toEqual({ name: "Amina Otieno", email: "nope", phone: "123" });
    expect(await prisma.order.count()).toBe(0);
  });

  it("does nothing when online payment is disabled", async () => {
    h.enabled = false;
    const res = await actions.startCheckoutAction({ ok: false }, checkout());
    expect(res).toMatchObject({ ok: false, message: expect.stringMatching(/isn't available/) });
    expect(await prisma.order.count()).toBe(0);
  });

  it("shows the order page instead of failing when Paystack can't start the payment", async () => {
    const { PaystackError } = await import("@/server/payments/paystack");
    h.ps!.failInitialize(new PaystackError("http", "down", 503));
    await expect(actions.startCheckoutAction({ ok: false }, checkout())).rejects.toMatchObject({ url: expect.stringMatching(/^\/checkout\/order\/TEST-MRV-[0-9A-Z]{10}\?token=/) });
  });

  it("rate-limits checkout starts per client", async () => {
    for (let i = 0; i < 10; i++) await actions.startCheckoutAction({ ok: false }, checkout({ expectedTotalMinor: "1" }));
    expect(await actions.startCheckoutAction({ ok: false }, checkout())).toMatchObject({ message: expect.stringMatching(/Too many attempts/) });
  });

  describe("existing orders", () => {
    async function pendingOrder() {
      await actions.startCheckoutAction({ ok: false }, checkout()).catch(() => {});
      return prisma.order.findFirstOrThrow({ include: { payments: true } });
    }

    it("refuses retry and status checks without the order's own token", async () => {
      const order = await pendingOrder();
      const other = orderAccessToken("MRV-ZZZZZZZZZZ");
      for (const token of ["", "guess", other]) {
        expect(await actions.retryPaymentAction({ ok: false }, form({ reference: order.reference, token }))).toMatchObject({ message: "This order link isn't valid." });
        expect(await actions.checkPaymentAction({ ok: false }, form({ reference: order.reference, token }))).toMatchObject({ message: "This order link isn't valid." });
      }
      expect(h.ps!.verified).toHaveLength(0);
    });

    it("checks status with Paystack and confirms a completed payment", async () => {
      const order = await pendingOrder();
      h.ps!.settle(order.payments[0].reference, { status: "success" });
      const res = await actions.checkPaymentAction({ ok: false }, form({ reference: order.reference, token: orderAccessToken(order.reference) }));
      expect(res).toMatchObject({ ok: true, message: "Payment confirmed." });
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("PAID");
    });

    it("sends the customer back to the same open checkout rather than a second one", async () => {
      const order = await pendingOrder();
      await expect(actions.retryPaymentAction({ ok: false }, form({ reference: order.reference, token: orderAccessToken(order.reference) }))).rejects.toMatchObject({
        url: order.payments[0].authorizationUrl,
      });
      expect(h.ps!.initialized).toHaveLength(1);
    });

    it("never takes a second payment for a paid order", async () => {
      const order = await pendingOrder();
      h.ps!.settle(order.payments[0].reference, { status: "success" });
      const res = await actions.retryPaymentAction({ ok: false }, form({ reference: order.reference, token: orderAccessToken(order.reference) }));
      expect(res).toMatchObject({ message: "This order is already paid." });
      expect(h.ps!.initialized).toHaveLength(1);
    });
  });
});
