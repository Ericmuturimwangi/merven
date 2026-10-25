import { describe, expect, it } from "vitest";
import { readPaymentConfig } from "@/server/payments/config";

// Live (real-money) configuration. Every condition is required; anything
// missing, malformed or contradictory keeps payments off. Keys are fake.

const LIVE_KEY = "sk_live_0123456789abcdefABCDEF";
const TEST_KEY = "sk_test_0123456789abcdef0123";
const TOKEN = "local-test-db-token-0123456789";

// A genuine Vercel production deployment with every live setting.
const live = {
  PAYMENTS_ENABLED: "true",
  PAYMENTS_ENVIRONMENT: "production",
  PAYSTACK_MODE: "live",
  PAYSTACK_SECRET_KEY: LIVE_KEY,
  NEXT_PUBLIC_SITE_URL: "https://mervenfashions.co.ke",
  VERCEL: "1",
  VERCEL_ENV: "production",
  VERCEL_TARGET_ENV: "production",
  VERCEL_URL: "merven-abc123-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "mervenfashions.co.ke",
};
const local = {
  PAYMENTS_ENABLED: "true",
  PAYMENTS_ENVIRONMENT: "local",
  PAYMENTS_TEST_DATABASE_TOKEN: TOKEN,
  PAYSTACK_MODE: "test",
  PAYSTACK_SECRET_KEY: TEST_KEY,
  NEXT_PUBLIC_SITE_URL: "http://localhost:3000",
};
const preview = {
  ...local,
  PAYMENTS_ENVIRONMENT: "preview",
  NEXT_PUBLIC_SITE_URL: "https://merven-git-feature-team.vercel.app",
  VERCEL: "1",
  VERCEL_ENV: "preview",
  VERCEL_TARGET_ENV: "preview",
  VERCEL_URL: "merven-def456-team.vercel.app",
  VERCEL_PROJECT_PRODUCTION_URL: "mervenfashions.co.ke",
};

type Env = Record<string, string | undefined>;
const off = (env: Env) => {
  const cfg = readPaymentConfig(env);
  expect(cfg.enabled).toBe(false);
  // Never echoes a key value (a prefix hint like "sk_live_…" in the reason is fine).
  const text = JSON.stringify(cfg);
  for (const secret of [LIVE_KEY, TEST_KEY, env.PAYSTACK_SECRET_KEY].filter((s): s is string => !!s && s.length > 8)) expect(text).not.toContain(secret);
  return cfg;
};

describe("live mode: enabled only on a genuine production deployment with every live setting", () => {
  it("enables live checkout with the production callback", () => {
    expect(readPaymentConfig(live)).toEqual({
      enabled: true,
      mode: "live",
      environment: "production",
      secretKey: LIVE_KEY,
      callbackUrl: "https://mervenfashions.co.ke/checkout/callback",
      channels: ["card", "mobile_money"],
      testDatabaseToken: null,
    });
  });

  it("accepts an absent VERCEL_TARGET_ENV and a restricted channel list", () => {
    expect(readPaymentConfig({ ...live, VERCEL_TARGET_ENV: undefined }).enabled).toBe(true);
    expect(readPaymentConfig({ ...live, PAYSTACK_CHANNELS: "mobile_money" })).toMatchObject({ enabled: true, channels: ["mobile_money"] });
  });

  it("builds the callback from the site's origin only", () => {
    expect(readPaymentConfig({ ...live, NEXT_PUBLIC_SITE_URL: "https://mervenfashions.co.ke/shop?x=https://evil.example" })).toMatchObject({
      callbackUrl: "https://mervenfashions.co.ke/checkout/callback",
    });
  });
});

describe("live mode: each required condition", () => {
  it.each<[string, Env]>([
    // enable switch
    ["enable switch missing", { ...live, PAYMENTS_ENABLED: undefined }],
    ["enable switch false", { ...live, PAYMENTS_ENABLED: "false" }],
    ["enable switch not exactly true", { ...live, PAYMENTS_ENABLED: "1" }],
    ["enable switch with different case", { ...live, PAYMENTS_ENABLED: "TRUE" }],
    // environment declaration
    ["environment missing", { ...live, PAYMENTS_ENVIRONMENT: undefined }],
    ["environment with different case", { ...live, PAYMENTS_ENVIRONMENT: "Production" }],
    ["environment misspelt", { ...live, PAYMENTS_ENVIRONMENT: "prod" }],
    ["environment declared local on production", { ...live, PAYMENTS_ENVIRONMENT: "local" }],
    ["environment declared preview on production", { ...live, PAYMENTS_ENVIRONMENT: "preview" }],
    // mode
    ["mode missing", { ...live, PAYSTACK_MODE: undefined }],
    ["mode test", { ...live, PAYSTACK_MODE: "test" }],
    ["mode with different case", { ...live, PAYSTACK_MODE: "LIVE" }],
    // key
    ["key missing", { ...live, PAYSTACK_SECRET_KEY: undefined }],
    ["test key with live mode", { ...live, PAYSTACK_SECRET_KEY: TEST_KEY }],
    ["public live key instead of secret", { ...live, PAYSTACK_SECRET_KEY: "pk_live_0123456789abcdefABCDEF" }],
    ["live key too short", { ...live, PAYSTACK_SECRET_KEY: "sk_live_abc" }],
    ["live key with unexpected characters", { ...live, PAYSTACK_SECRET_KEY: "sk_live_0123456789ab cdef" }],
    // runtime: positively identified Vercel production
    ["not on Vercel at all", { ...live, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined, VERCEL_URL: undefined }],
    ["VERCEL flag missing", { ...live, VERCEL: undefined }],
    ["VERCEL flag not 1", { ...live, VERCEL: "true" }],
    ["VERCEL_ENV preview", { ...live, VERCEL_ENV: "preview" }],
    ["VERCEL_ENV missing (system variables hidden)", { ...live, VERCEL_ENV: undefined }],
    ["VERCEL_ENV development", { ...live, VERCEL_ENV: "development" }],
    ["target environment preview", { ...live, VERCEL_TARGET_ENV: "preview" }],
    ["production domain unknown", { ...live, VERCEL_PROJECT_PRODUCTION_URL: undefined }],
    // site URL
    ["site URL missing", { ...live, NEXT_PUBLIC_SITE_URL: undefined }],
    ["site URL malformed", { ...live, NEXT_PUBLIC_SITE_URL: "mervenfashions.co.ke" }],
    ["site URL over http", { ...live, NEXT_PUBLIC_SITE_URL: "http://mervenfashions.co.ke" }],
    ["site URL on another domain", { ...live, NEXT_PUBLIC_SITE_URL: "https://evil.example" }],
    ["site URL on a look-alike domain", { ...live, NEXT_PUBLIC_SITE_URL: "https://mervenfashions.co.ke.evil.example" }],
    ["site URL on the preview deployment URL", { ...live, NEXT_PUBLIC_SITE_URL: "https://merven-abc123-team.vercel.app" }],
    ["site URL on localhost", { ...live, NEXT_PUBLIC_SITE_URL: "https://localhost" }],
    ["site URL with a port", { ...live, NEXT_PUBLIC_SITE_URL: "https://mervenfashions.co.ke:8443" }],
    // contradictory test-only settings
    ["test-database token set in production", { ...live, PAYMENTS_TEST_DATABASE_TOKEN: TOKEN }],
    ["mock API set in production", { ...live, PAYSTACK_API_BASE_URL: "http://127.0.0.1:4010" }],
    // channels
    ["unsupported channel", { ...live, PAYSTACK_CHANNELS: "card,ussd" }],
    ["empty channel list", { ...live, PAYSTACK_CHANNELS: " , " }],
  ])("off: %s", (_label, env) => {
    off(env);
  });

  it("explains the refusal without revealing the key", () => {
    expect(off({ ...live, PAYSTACK_SECRET_KEY: TEST_KEY })).toMatchObject({ reason: expect.stringContaining("live secret key") });
    expect(off({ ...live, VERCEL_ENV: "preview" })).toMatchObject({ reason: expect.stringContaining("Vercel production deployment") });
  });
});

describe("live and test credentials never cross", () => {
  it.each<[string, Env]>([
    ["live key + live mode on local", { ...local, PAYSTACK_MODE: "live", PAYSTACK_SECRET_KEY: LIVE_KEY }],
    ["live key + test mode on local", { ...local, PAYSTACK_SECRET_KEY: LIVE_KEY }],
    ["test key + live mode on local", { ...local, PAYSTACK_MODE: "live" }],
    ["live key + live mode on preview", { ...preview, PAYSTACK_MODE: "live", PAYSTACK_SECRET_KEY: LIVE_KEY }],
    ["live key + test mode on preview", { ...preview, PAYSTACK_SECRET_KEY: LIVE_KEY }],
    ["live settings declared local on a laptop pretending to be production", { ...live, PAYMENTS_ENVIRONMENT: "local", NEXT_PUBLIC_SITE_URL: "http://localhost:3000", VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined, VERCEL_URL: undefined, VERCEL_PROJECT_PRODUCTION_URL: undefined }],
    ["production URL alone (no Vercel runtime) with live settings", { ...live, VERCEL: undefined, VERCEL_ENV: undefined, VERCEL_TARGET_ENV: undefined, VERCEL_URL: undefined }],
    ["test key + test mode in production", { ...live, PAYSTACK_MODE: "test", PAYSTACK_SECRET_KEY: TEST_KEY, PAYMENTS_TEST_DATABASE_TOKEN: TOKEN }],
    ["test key + live mode in production", { ...live, PAYSTACK_SECRET_KEY: TEST_KEY }],
    ["live key + test mode in production", { ...live, PAYSTACK_MODE: "test" }],
    ["test settings declared local on the production deployment", { ...local, VERCEL: "1", VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "mervenfashions.co.ke" }],
    ["test settings declared preview on the production deployment", { ...preview, VERCEL_ENV: "production", VERCEL_TARGET_ENV: "production" }],
  ])("off: %s", (_label, env) => {
    off(env);
  });

  it("states why a live key is refused outside production", () => {
    expect(off({ ...local, PAYSTACK_SECRET_KEY: LIVE_KEY })).toMatchObject({ reason: "Live keys are only accepted on the production deployment." });
  });

  it("keeps test mode exactly as before on local and preview", () => {
    expect(readPaymentConfig(local)).toMatchObject({ enabled: true, mode: "test", environment: "local", testDatabaseToken: TOKEN });
    expect(readPaymentConfig(preview)).toMatchObject({ enabled: true, mode: "test", environment: "preview", testDatabaseToken: TOKEN });
  });
});
