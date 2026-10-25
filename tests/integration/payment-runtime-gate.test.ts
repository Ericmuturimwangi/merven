import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEST_DB_TOKEN } from "../support/fake-paystack";
import { hasTestDb, testPrisma } from "../support/db";

// The single runtime gate used by every checkout action, the callback, the
// webhook, the admin re-check and the storefront: valid config AND an approved
// database. Uses the isolated test database and fake environment values.

vi.mock("@/server/db", async () => ({ db: (await import("../support/db")).testPrisma() }));
vi.mock("next/cache", () => ({ revalidateTag: () => {}, cacheTag: () => {}, cacheLife: () => {} }));

const prisma = testPrisma();
const localEnv = {
  PAYMENTS_ENABLED: "true",
  PAYMENTS_ENVIRONMENT: "local",
  PAYMENTS_TEST_DATABASE_TOKEN: TEST_DB_TOKEN,
  PAYSTACK_MODE: "test",
  PAYSTACK_SECRET_KEY: "sk_test_0123456789abcdef0123",
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};
const setMarker = (value: string | null) =>
  prisma.$executeRawUnsafe(`DO $$ BEGIN EXECUTE format('COMMENT ON DATABASE %I IS %L', current_database(), ${value === null ? "NULL::text" : `'${value}'`}); END $$;`);

describe.skipIf(!hasTestDb)("runtime payment gate", () => {
  beforeEach(() => {
    for (const k of ["VERCEL", "VERCEL_ENV", "VERCEL_TARGET_ENV", "VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL", "PAYSTACK_API_BASE_URL"]) vi.stubEnv(k, "");
    for (const [k, v] of Object.entries(localEnv)) vi.stubEnv(k, v);
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await setMarker(`merven-test-payments:${TEST_DB_TOKEN}`);
  });
  afterAll(() => prisma.$disconnect());

  const runtime = () => import("@/server/payments/runtime");

  it("enables local test checkout with explicit config and an approved database", async () => {
    const { paymentDeps, paymentAvailability } = await runtime();
    expect(await paymentDeps()).toMatchObject({ config: { environment: "local", mode: "test" } });
    expect(await paymentAvailability()).toEqual({ available: true, testMode: true });
  });

  it("is off when the database marker is missing, even with a valid config", async () => {
    await setMarker(null);
    const { paymentDeps, paymentAvailability } = await runtime();
    expect(await paymentDeps()).toBeNull();
    expect(await paymentAvailability()).toEqual({ available: false, testMode: false });
  });

  it("is off when the configured token doesn't match the database", async () => {
    vi.stubEnv("PAYMENTS_TEST_DATABASE_TOKEN", "a-different-token-for-another-db");
    expect(await (await runtime()).paymentDeps()).toBeNull();
  });

  it("is off on production even with an approved database", async () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(await (await runtime()).paymentDeps()).toBeNull();
  });

  it("is off on a production domain when Vercel hides its system variables", async () => {
    vi.stubEnv("PAYMENTS_ENVIRONMENT", "preview");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://merven-69d4.vercel.app");
    expect(await (await runtime()).paymentDeps()).toBeNull();
  });
});
