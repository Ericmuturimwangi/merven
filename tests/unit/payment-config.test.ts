import { describe, expect, it } from "vitest";
import { readPaymentConfig } from "@/server/payments/config";

const TOKEN = "local-test-db-token-0123456789";
const TEST_KEY = "sk_test_0123456789abcdef0123";

// Explicit local development configuration (the only way checkout runs off Vercel).
const local = {
  PAYMENTS_ENABLED: "true",
  PAYMENTS_ENVIRONMENT: "local",
  PAYMENTS_TEST_DATABASE_TOKEN: TOKEN,
  PAYSTACK_MODE: "test",
  PAYSTACK_SECRET_KEY: TEST_KEY,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};

// A Vercel preview deployment with system variables exposed and both opt-ins.
const preview = {
  ...local,
  PAYMENTS_ENVIRONMENT: "preview",
  NEXT_PUBLIC_SITE_URL: "https://merven-69d4-git-feature-team.vercel.app",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_URL: "merven-69d4-abc123-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "merven-69d4.vercel.app",
};

// Production with everything a careless operator might set.
const productionVars = {
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  VERCEL_URL: "merven-69d4-xyz-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "merven-69d4.vercel.app",
  NEXT_PUBLIC_SITE_URL: "https://merven-69d4.vercel.app",
};

const enabled = (env: Record<string, string | undefined>) => readPaymentConfig(env).enabled;

describe("payment gate: production is never enabled", () => {
  it.each([
    ["all Vercel production variables + local opt-in", { ...local, ...productionVars }],
    ["all Vercel production variables + preview opt-in", { ...preview, ...productionVars, PAYMENTS_ENVIRONMENT: "preview" }],
    ["production domain, system variables NOT exposed, preview opt-in", { ...local, PAYMENTS_ENVIRONMENT: "preview", NEXT_PUBLIC_SITE_URL: "https://merven-69d4.vercel.app" }],
    ["production domain, system variables NOT exposed, local opt-in", { ...local, NEXT_PUBLIC_SITE_URL: "https://merven-69d4.vercel.app" }],
    ["production domain, system variables NOT exposed, no environment set", { ...local, PAYMENTS_ENVIRONMENT: undefined, NEXT_PUBLIC_SITE_URL: "https://merven-69d4.vercel.app" }],
    ["contradictory: VERCEL_ENV=preview but target production", { ...preview, VERCEL_TARGET_ENV: "production" }],
    ["contradictory: VERCEL_ENV=production but target preview", { ...preview, VERCEL_ENV: "production" }],
    ["contradictory: preview opt-in but no VERCEL flag", { ...preview, VERCEL: undefined }],
    ["contradictory: preview deployment serving the production domain", { ...preview, NEXT_PUBLIC_SITE_URL: "https://merven-69d4.vercel.app" }],
    ["preview without a known production domain", { ...preview, VERCEL_PROJECT_PRODUCTION_URL: undefined }],
    ["local opt-in on a Vercel deployment", { ...local, VERCEL: "1", VERCEL_ENV: "preview" }],
    ["local opt-in with only VERCEL_URL present", { ...local, VERCEL_URL: "x.vercel.app" }],
    ["PAYMENTS_ENVIRONMENT=production", { ...local, PAYMENTS_ENVIRONMENT: "production" }],
  ])("off: %s", (_l, env) => {
    expect(enabled(env)).toBe(false);
  });
});

describe("payment gate: unknown or incomplete environments stay off", () => {
  it.each([
    ["nothing configured", {}],
    ["local development, payment flags absent", { NEXT_PUBLIC_SITE_URL: "http://localhost:3000" }],
    ["unknown hosting (no Vercel, public https site, local opt-in)", { ...local, NEXT_PUBLIC_SITE_URL: "https://shop.example.com" }],
    ["unknown hosting, no environment set", { ...local, PAYMENTS_ENVIRONMENT: undefined }],
    ["unrecognised environment value", { ...local, PAYMENTS_ENVIRONMENT: "staging" }],
    ["environment value with different case", { ...local, PAYMENTS_ENVIRONMENT: "Local" }],
    ["flag not exactly true", { ...local, PAYMENTS_ENABLED: "1" }],
    ["preview without explicit test-payment opt-in", { ...preview, PAYMENTS_ENABLED: undefined }],
    ["preview without the database-safety token", { ...preview, PAYMENTS_TEST_DATABASE_TOKEN: undefined }],
    ["local without the database-safety token", { ...local, PAYMENTS_TEST_DATABASE_TOKEN: undefined }],
    ["database token too short", { ...local, PAYMENTS_TEST_DATABASE_TOKEN: "short" }],
    ["database token with unsafe characters", { ...local, PAYMENTS_TEST_DATABASE_TOKEN: "x".repeat(24) + "'; drop" }],
    ["site URL missing", { ...local, NEXT_PUBLIC_SITE_URL: undefined }],
    ["preview over plain http", { ...preview, NEXT_PUBLIC_SITE_URL: "http://merven-69d4-git-x.vercel.app" }],
  ])("off: %s", (_l, env) => {
    const cfg = readPaymentConfig(env as Record<string, string | undefined>);
    expect(cfg.enabled).toBe(false);
    expect(cfg).not.toHaveProperty("secretKey");
  });
});

describe("payment gate: live keys and live mode never enable payments", () => {
  it.each([
    ["live mode", { ...local, PAYSTACK_MODE: "live" }],
    ["mode missing", { ...local, PAYSTACK_MODE: undefined }],
    ["live key in test mode", { ...local, PAYSTACK_SECRET_KEY: "sk_live_0123456789abcdef0123" }],
    ["live key and live mode on preview", { ...preview, PAYSTACK_MODE: "live", PAYSTACK_SECRET_KEY: "sk_live_0123456789abcdef0123" }],
    ["public key instead of secret", { ...local, PAYSTACK_SECRET_KEY: "pk_test_0123456789abcdef0123" }],
    ["key too short", { ...local, PAYSTACK_SECRET_KEY: "sk_test_x" }],
  ])("off: %s", (_l, env) => {
    expect(enabled(env)).toBe(false);
  });
});

describe("payment gate: explicitly configured test environments", () => {
  it("enables local test checkout only with every explicit setting", () => {
    expect(readPaymentConfig(local)).toEqual({
      enabled: true,
      mode: "test",
      environment: "local",
      secretKey: TEST_KEY,
      callbackUrl: "http://localhost:3000/checkout/callback",
      channels: ["card", "mobile_money"],
      testDatabaseToken: TOKEN,
    });
  });

  it("enables preview test checkout only with both opt-ins on a positively identified preview", () => {
    expect(readPaymentConfig(preview)).toMatchObject({
      enabled: true,
      environment: "preview",
      callbackUrl: "https://merven-69d4-git-feature-team.vercel.app/checkout/callback",
      testDatabaseToken: TOKEN,
    });
  });

  it("builds the callback URL from the configured site only", () => {
    expect(readPaymentConfig({ ...local, NEXT_PUBLIC_SITE_URL: "http://localhost:3000/a?x=https://evil.example" })).toMatchObject({
      callbackUrl: "http://localhost:3000/checkout/callback",
    });
  });

  it("restricts channels to card and M-PESA mobile money", () => {
    expect(readPaymentConfig({ ...local, PAYSTACK_CHANNELS: "mobile_money" })).toMatchObject({ channels: ["mobile_money"] });
    expect(enabled({ ...local, PAYSTACK_CHANNELS: "card,ussd" })).toBe(false);
    expect(enabled({ ...local, PAYSTACK_CHANNELS: " , " })).toBe(false);
  });
});

describe("payment gate: the mock API stays on loopback in local development", () => {
  it("accepts a loopback mock only with PAYMENTS_ENVIRONMENT=local", () => {
    expect(readPaymentConfig({ ...local, PAYSTACK_API_BASE_URL: "http://127.0.0.1:4010" })).toMatchObject({ enabled: true, apiBaseUrl: "http://127.0.0.1:4010" });
    expect(readPaymentConfig(local)).not.toHaveProperty("apiBaseUrl");
  });
  it.each([
    ["an external host", { ...local, PAYSTACK_API_BASE_URL: "https://evil.example" }],
    ["a look-alike host", { ...local, PAYSTACK_API_BASE_URL: "http://localhost.evil.example" }],
    ["an invalid URL", { ...local, PAYSTACK_API_BASE_URL: "not a url" }],
    ["a preview deployment, even on loopback", { ...preview, PAYSTACK_API_BASE_URL: "http://127.0.0.1:4010" }],
  ])("off: mock on %s", (_l, env) => {
    expect(enabled(env)).toBe(false);
  });
});
