import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as svc from "@/server/orders/order-service";
import { checkoutInputSchema } from "@/server/orders/checkout-input";
import { fakePaystack, TEST_DB_TOKEN, testOrderOpts, testPaymentConfig } from "../support/fake-paystack";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Live mode through the real gate, order service, callback and webhook, on the
// isolated test database. Live payments must never touch a test-marked
// database, and test and live attempts can never be started or settled with
// the other mode's settings. Fake environment values and fake Paystack only.

vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("next/cache", () => ({ revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {}, updateTag: () => {} }));
vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const prisma = testPrisma();
const LIVE_KEY = "sk_live_0123456789abcdefABCDEF";
const liveEnv = {
  PAYMENTS_ENABLED: "true",
  PAYMENTS_ENVIRONMENT: "production",
  PAYSTACK_MODE: "live",
  PAYSTACK_SECRET_KEY: LIVE_KEY,
  NEXT_PUBLIC_SITE_URL: "https://mervenfashions.co.ke",
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  VERCEL_PROJECT_PRODUCTION_URL: "mervenfashions.co.ke",
};
const liveConfig = {
  enabled: true as const,
  mode: "live" as const,
  environment: "production" as const,
  secretKey: LIVE_KEY,
  callbackUrl: "https://mervenfashions.co.ke/checkout/callback",
  channels: ["card" as const, "mobile_money" as const],
  testDatabaseToken: null,
};
const MARKER = `merven-test-payments:${TEST_DB_TOKEN}`;
const setMarker = (value: string | null) =>
  prisma.$executeRawUnsafe(`DO $$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), ${value === null ? "NULL::text" : `'${value}'`}); END $$;`);

describe.skipIf(!hasTestDb)("live payment gate", () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  let variantId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    fetchSpy.mockClear();
    for (const k of ["PAYMENTS_TEST_DATABASE_TOKEN", "PAYSTACK_API_BASE_URL", "PAYSTACK_CHANNELS", "VERCEL_URL"]) vi.stubEnv(k, undefined);
    for (const [k, v] of Object.entries(liveEnv)) vi.stubEnv(k, v);
    const cat = await makeCategory(prisma, "Dresses");
    await makeProduct(prisma, { categoryId: cat.id, slug: "tie-dress", priceMinor: 250000, variants: [{ size: "M", colour: "White", stock: 5 }] });
    variantId = (await prisma.productVariant.findFirstOrThrow()).id;
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await setMarker(MARKER); // the isolated test database always ends marked
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  afterAll(() => prisma.$disconnect());

  const input = () => checkoutInputSchema.parse({ name: "Amina Otieno", email: "amina@example.com", phone: "0712345678", items: [{ variantId, quantity: 1 }], expectedTotalMinor: 250000 });
  const runtime = () => import("@/server/payments/runtime");

  describe("the central gate", () => {
    it("refuses live settings on a test-marked database", async () => {
      const { paymentDeps, paymentAvailability } = await runtime();
      expect(await paymentDeps()).toBeNull();
      expect(await paymentAvailability()).toEqual({ available: false, testMode: false });
    });

    it("enables live mode only on an unmarked database with every live setting", async () => {
      await setMarker(null);
      const { paymentDeps, paymentAvailability } = await runtime();
      expect(await paymentDeps()).toMatchObject({ config: { mode: "live", environment: "production", testDatabaseToken: null } });
      expect(await paymentAvailability()).toEqual({ available: true, testMode: false });
    });

    it.each([
      ["PAYMENTS_ENABLED", "false"],
      ["PAYMENTS_ENVIRONMENT", "preview"],
      ["PAYSTACK_MODE", "test"],
      ["PAYSTACK_SECRET_KEY", "sk_test_0123456789abcdef0123"],
      ["VERCEL_ENV", "preview"],
      ["NEXT_PUBLIC_SITE_URL", "http://mervenfashions.co.ke"],
    ])("is off when %s is %s, even on an unmarked database", async (name, value) => {
      await setMarker(null);
      vi.stubEnv(name, value);
      expect(await (await runtime()).paymentDeps()).toBeNull();
    });

    it("keeps test settings off on an unmarked (production-like) database", async () => {
      await setMarker(null);
      for (const [k, v] of Object.entries({ PAYMENTS_ENVIRONMENT: "local", PAYSTACK_MODE: "test", PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef0123", PAYMENTS_TEST_DATABASE_TOKEN: TEST_DB_TOKEN, NEXT_PUBLIC_SITE_URL: "http://localhost:3000", VERCEL: "", VERCEL_ENV: "", VERCEL_TARGET_ENV: "", VERCEL_PROJECT_PRODUCTION_URL: "" })) vi.stubEnv(k, v);
      expect(await (await runtime()).paymentDeps()).toBeNull();
    });
  });

  describe("routes use the central gate", () => {
    it("the webhook refuses (503) when live settings meet a test-marked database", async () => {
      const { POST } = await import("@/app/api/webhooks/paystack/route");
      const res = await POST(new Request("https://mervenfashions.co.ke/api/webhooks/paystack", { method: "POST", body: "{}", headers: { "x-paystack-signature": "0".repeat(128) } }));
      expect(res.status).toBe(503);
      expect(await prisma.webhookEvent.count()).toBe(0);
    });

    it("the callback sends the customer to the neutral page without verifying", async () => {
      const { GET } = await import("@/app/checkout/callback/route");
      const res = await GET(new Request("https://mervenfashions.co.ke/checkout/callback?reference=MRV-0000000000-P00000000"));
      expect(res.status).toBe(303);
      expect(res.headers.get("location")).toMatch(/\/checkout\/unknown$/);
    });
  });

  describe("the order service enforces the same decision", () => {
    it("creates no live order on a test-marked database", async () => {
      expect(await svc.createOrder(prisma, input(), { testMode: false })).toEqual({ ok: false, reason: "test_database_not_approved" });
      expect(await prisma.order.count()).toBe(0);
    });

    it("creates no test order on an unmarked database", async () => {
      await setMarker(null);
      expect(await svc.createOrder(prisma, input(), testOrderOpts)).toEqual({ ok: false, reason: "test_database_not_approved" });
      expect(await prisma.order.count()).toBe(0);
    });

    it("gives live orders references that can't be mistaken for test ones", async () => {
      await setMarker(null);
      const created = await svc.createOrder(prisma, input(), { testMode: false });
      if (!created.ok) throw new Error(created.reason);
      expect(created.order.reference).toMatch(/^MRV-[0-9A-Z]{10}$/);
      expect(created.attempt.reference).toMatch(/^MRV-[0-9A-Z]{10}-P[0-9A-Z]{8}$/);
      expect(await prisma.order.findUniqueOrThrow({ where: { id: created.order.id } })).toMatchObject({ testMode: false });
    });

    it("never starts a test attempt with live settings, or a live attempt with test settings", async () => {
      const ps = fakePaystack();
      const testOrder = await svc.createOrder(prisma, input(), testOrderOpts);
      if (!testOrder.ok) throw new Error("setup");
      expect(await svc.initializeAttempt({ prisma, paystack: ps.client, config: liveConfig }, testOrder.attempt.id)).toEqual({ ok: false, reason: "not_initializable" });
      await setMarker(null);
      const liveOrder = await svc.createOrder(prisma, input(), { testMode: false });
      if (!liveOrder.ok) throw new Error("setup");
      expect(await svc.initializeAttempt({ prisma, paystack: ps.client, config: testPaymentConfig }, liveOrder.attempt.id)).toEqual({ ok: false, reason: "not_initializable" });
      expect(ps.initialized).toHaveLength(0);
    });

    it("verifies a live payment only against Paystack's live environment, amount, currency and reference", async () => {
      await setMarker(null);
      const ps = fakePaystack();
      const live = await svc.createOrder(prisma, input(), { testMode: false });
      if (!live.ok) throw new Error("setup");
      expect((await svc.initializeAttempt({ prisma, paystack: ps.client, config: liveConfig }, live.attempt.id)).ok).toBe(true);
      const base = { id: "9001", status: "success", reference: live.attempt.reference, amount: 250000, currency: "KES", channel: "card", paidAt: "2026-10-25T10:00:00.000Z", gatewayResponse: "Approved" };
      // A test-environment transaction can never pay a live order (fake Paystack reports domain "test").
      expect((await svc.applyVerification(prisma, live.attempt.reference, { ...base, domain: "test" }, "live")).outcome).toBe("mismatch");
      for (const wrong of [{ amount: 249999 }, { currency: "NGN" }, { reference: "MRV-OTHER" }]) {
        expect((await svc.applyVerification(prisma, live.attempt.reference, { ...base, domain: "live", ...wrong }, "live")).outcome).toBe("mismatch");
      }
      expect((await prisma.order.findUniqueOrThrow({ where: { id: live.order.id } })).status).toBe("PENDING_PAYMENT");
      // Only a matching live success pays it, once.
      await prisma.paymentAttempt.update({ where: { id: live.attempt.id }, data: { status: "PENDING" } });
      expect((await svc.applyVerification(prisma, live.attempt.reference, { ...base, domain: "live" }, "live")).outcome).toBe("paid");
      expect((await svc.applyVerification(prisma, live.attempt.reference, { ...base, domain: "live" }, "live")).outcome).toBe("already_paid");
      expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock).toBe(4);
    });

    it("never settles a live payment into a test-marked database", async () => {
      await setMarker(null);
      const live = await svc.createOrder(prisma, input(), { testMode: false });
      if (!live.ok) throw new Error("setup");
      await setMarker(MARKER); // the database is (re)marked as a test database
      const tx = { id: "9002", domain: "live", status: "success", reference: live.attempt.reference, amount: 250000, currency: "KES", channel: "card", paidAt: null, gatewayResponse: null };
      expect((await svc.applyVerification(prisma, live.attempt.reference, tx, "live")).outcome).toBe("test_database_not_approved");
      expect(await prisma.order.findUniqueOrThrow({ where: { id: live.order.id } })).toMatchObject({ status: "PENDING_PAYMENT", stockStatus: "NOT_APPLIED" });
    });

    it("never settles a test payment with live settings", async () => {
      const test = await svc.createOrder(prisma, input(), testOrderOpts);
      if (!test.ok) throw new Error("setup");
      const tx = { id: "9003", domain: "live", status: "success", reference: test.attempt.reference, amount: 250000, currency: "KES", channel: "card", paidAt: null, gatewayResponse: null };
      expect((await svc.applyVerification(prisma, test.attempt.reference, tx, "live", { testDatabaseToken: TEST_DB_TOKEN })).outcome).toBe("mismatch");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: test.order.id } })).status).toBe("PENDING_PAYMENT");
    });
  });
});
