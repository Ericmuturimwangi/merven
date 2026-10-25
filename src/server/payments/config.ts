// Online payment configuration. FAIL-CLOSED: anything missing, unexpected,
// contradictory or risky yields `enabled: false`. Each deployment accepts only
// its own kind of credentials:
//
//   local, preview  → Paystack TEST mode only (sk_test_…), test-marked database
//   production      → Paystack LIVE mode only (sk_live_…), never a test-marked database
//
//   PAYMENTS_ENABLED=true            turn on checkout (default: off)
//   PAYMENTS_ENVIRONMENT=local|preview|production
//                                    explicit deployment policy (no default)
//   PAYSTACK_MODE=test|live          must match the environment (test for local/preview,
//                                    live for production)
//   PAYSTACK_SECRET_KEY              server-only; its prefix must match the mode
//                                    (sk_test_ for test, sk_live_ for live)
//   PAYMENTS_TEST_DATABASE_TOKEN     test mode only: must match the marker stored IN the
//                                    database (see ./test-database.ts). Refused in production.
//   PAYSTACK_CHANNELS=card,mobile_money   optional; defaults to card + mobile_money
//   NEXT_PUBLIC_SITE_URL             trusted origin for the Paystack callback URL
//   PAYSTACK_API_BASE_URL            LOCAL QA ONLY: a loopback mock of the Paystack API.
//                                    Allowed only with PAYMENTS_ENVIRONMENT=local.
//
// The deployment must be POSITIVELY identified from Vercel's system variables,
// never from the site URL alone (which is configuration, not runtime evidence):
// production needs VERCEL=1, VERCEL_ENV=production and a site URL on the
// project's production domain over https. An unknown or partially configured
// environment (e.g. Vercel system variables not exposed) matches nothing and
// stays off. Never derived from request headers or user input.

export const PAYSTACK_ALLOWED_CHANNELS = ["card", "mobile_money"] as const;
export type PaystackChannel = (typeof PAYSTACK_ALLOWED_CHANNELS)[number];
export type PaymentEnvironment = "local" | "preview" | "production";

type CommonConfig = {
  enabled: true;
  secretKey: string;
  callbackUrl: string;
  channels: PaystackChannel[];
  apiBaseUrl?: string;
};

export type PaymentConfig =
  | { enabled: false; reason: string }
  | (CommonConfig & {
      mode: "test";
      environment: "local" | "preview";
      /** Expected database marker token; verified against the database at runtime. */
      testDatabaseToken: string;
    })
  | (CommonConfig & {
      mode: "live";
      environment: "production";
      /** Live mode never uses a test-database token. */
      testDatabaseToken: null;
    });

type Env = Record<string, string | undefined>;

const off = (reason: string): PaymentConfig => ({ enabled: false, reason });
const LOOPBACK = new Set(["localhost", "127.0.0.1"]);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,128}$/;

/** Any Vercel system variable means "this is a Vercel deployment". */
function onVercel(env: Env) {
  return Boolean(env.VERCEL || env.VERCEL_ENV || env.VERCEL_TARGET_ENV || env.VERCEL_URL || env.VERCEL_PROJECT_PRODUCTION_URL);
}

const LIVE_KEY = /^sk_live_[A-Za-z0-9]{12,}$/;

/** Channels requested for Paystack checkout, or null if any is not allowed. */
function readChannels(env: Env): PaystackChannel[] | null {
  const requested = (env.PAYSTACK_CHANNELS ?? "card,mobile_money")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  if (requested.length === 0 || requested.some((c) => !PAYSTACK_ALLOWED_CHANNELS.includes(c as PaystackChannel))) return null;
  return [...new Set(requested)] as PaystackChannel[];
}

/**
 * Live (real-money) configuration. Every condition is required; the site URL
 * is checked against Vercel's own record of the production domain, so it can't
 * stand in for runtime evidence on its own.
 */
function readLiveConfig(env: Env, site: URL): PaymentConfig {
  if (env.VERCEL !== "1" || env.VERCEL_ENV !== "production") {
    return off("PAYMENTS_ENVIRONMENT=production requires a Vercel production deployment (VERCEL=1, VERCEL_ENV=production).");
  }
  if (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== "production") return off("Vercel target environment is not production.");
  const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
  if (!productionHost) return off("The production domain (VERCEL_PROJECT_PRODUCTION_URL) is unknown.");
  if (site.protocol !== "https:") return off("NEXT_PUBLIC_SITE_URL must use https in production.");
  if (site.hostname.toLowerCase() !== productionHost || site.port !== "") return off("NEXT_PUBLIC_SITE_URL must be the project's production domain.");

  if (env.PAYSTACK_MODE?.trim() !== "live") return off("Production requires PAYSTACK_MODE=live.");
  const key = env.PAYSTACK_SECRET_KEY?.trim() ?? "";
  if (!LIVE_KEY.test(key)) return off("Production requires a Paystack live secret key (sk_live_…); test keys are refused.");
  // Test-only settings in production are contradictory: refuse rather than guess.
  if (env.PAYMENTS_TEST_DATABASE_TOKEN?.trim()) return off("PAYMENTS_TEST_DATABASE_TOKEN must not be set in production.");
  if (env.PAYSTACK_API_BASE_URL?.trim()) return off("PAYSTACK_API_BASE_URL must not be set in production.");

  const channels = readChannels(env);
  if (!channels) return off(`PAYSTACK_CHANNELS may only contain: ${PAYSTACK_ALLOWED_CHANNELS.join(", ")}.`);
  return {
    enabled: true,
    mode: "live",
    environment: "production",
    secretKey: key,
    callbackUrl: new URL("/checkout/callback", site.origin).toString(),
    channels,
    testDatabaseToken: null,
  };
}

export function readPaymentConfig(env: Env = process.env): PaymentConfig {
  if (env.PAYMENTS_ENABLED?.trim() !== "true") return off("Online payment is not enabled.");

  let site: URL;
  try {
    site = new URL(env.NEXT_PUBLIC_SITE_URL ?? "");
  } catch {
    return off("NEXT_PUBLIC_SITE_URL must be a valid URL for payment callbacks.");
  }

  // Positive identification of where we are running. No match -> off.
  const environment = env.PAYMENTS_ENVIRONMENT?.trim();
  if (environment === "production") return readLiveConfig(env, site);

  // Not production: any production signal blocks, whatever else is set.
  if (env.VERCEL_ENV === "production" || env.VERCEL_TARGET_ENV === "production") {
    return off("A production deployment requires PAYMENTS_ENVIRONMENT=production and live settings.");
  }

  if (environment === "local") {
    if (onVercel(env)) return off("PAYMENTS_ENVIRONMENT=local is not allowed on a Vercel deployment.");
    if (!LOOPBACK.has(site.hostname)) return off("Local test checkout requires a localhost NEXT_PUBLIC_SITE_URL.");
    if (site.protocol !== "http:" && site.protocol !== "https:") return off("NEXT_PUBLIC_SITE_URL must be http(s).");
  } else if (environment === "preview") {
    // Requires Vercel to positively report a preview deployment (system variables
    // exposed). If they are hidden, this cannot be verified and payments stay off.
    if (env.VERCEL !== "1" || env.VERCEL_ENV !== "preview") {
      return off("PAYMENTS_ENVIRONMENT=preview requires a Vercel preview deployment (VERCEL=1, VERCEL_ENV=preview).");
    }
    if (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== "preview") return off("Vercel target environment is not preview.");
    const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL?.trim().toLowerCase();
    if (!productionHost) return off("The production domain (VERCEL_PROJECT_PRODUCTION_URL) is unknown.");
    if (site.protocol !== "https:") return off("NEXT_PUBLIC_SITE_URL must use https on a preview deployment.");
    if (site.hostname.toLowerCase() === productionHost) return off("NEXT_PUBLIC_SITE_URL points at the production domain.");
  } else {
    return off("PAYMENTS_ENVIRONMENT must be explicitly set to local, preview or production.");
  }

  if (env.PAYSTACK_MODE?.trim() !== "test") return off("Local and preview deployments only support Paystack test mode.");

  const key = env.PAYSTACK_SECRET_KEY?.trim() ?? "";
  if (key.startsWith("sk_live_")) return off("Live keys are only accepted on the production deployment.");
  if (!key.startsWith("sk_test_") || key.length < 20) return off("A Paystack test secret key (sk_test_…) is required.");

  const testDatabaseToken = env.PAYMENTS_TEST_DATABASE_TOKEN?.trim() ?? "";
  if (!TOKEN_PATTERN.test(testDatabaseToken)) {
    return off("PAYMENTS_TEST_DATABASE_TOKEN (24–128 characters: letters, digits, - or _) is required.");
  }

  const channels = readChannels(env);
  if (!channels) return off(`PAYSTACK_CHANNELS may only contain: ${PAYSTACK_ALLOWED_CHANNELS.join(", ")}.`);

  let apiBaseUrl: string | undefined;
  if (env.PAYSTACK_API_BASE_URL) {
    let mock: URL;
    try {
      mock = new URL(env.PAYSTACK_API_BASE_URL);
    } catch {
      return off("PAYSTACK_API_BASE_URL is invalid.");
    }
    if (environment !== "local" || onVercel(env) || !LOOPBACK.has(mock.hostname)) {
      return off("PAYSTACK_API_BASE_URL is only allowed for a local mock (localhost) with PAYMENTS_ENVIRONMENT=local.");
    }
    apiBaseUrl = mock.origin;
  }

  return {
    enabled: true,
    mode: "test",
    environment,
    secretKey: key,
    callbackUrl: new URL("/checkout/callback", site.origin).toString(),
    channels,
    testDatabaseToken,
    ...(apiBaseUrl ? { apiBaseUrl } : {}),
  };
}

let warned = false;

/** Current configuration; logs the reason once when payments are off but were requested. */
export function paymentConfig(): PaymentConfig {
  const cfg = readPaymentConfig();
  if (!cfg.enabled && !warned && process.env.PAYMENTS_ENABLED === "true") {
    warned = true;
    console.warn(JSON.stringify({ level: "warn", event: "payments_disabled", reason: cfg.reason }));
  }
  return cfg;
}
