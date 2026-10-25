// Security headers for every response (next.config.ts).
//
// Content-Security-Policy is sent in two parts:
//
// - ENFORCED: directives that can't break the app: no framing, no plugins, no
//   <base> hijacking, and forms may only submit to this site or, after a
//   checkout form's redirect, to Paystack's hosted checkout page.
//
// - REPORT-ONLY: the full restrictive policy. Browsers report violations in the
//   console without blocking anything, so it can be checked on a Preview before
//   it is enforced. Everything the app loads is same-origin today: scripts and
//   styles from /_next, fonts self-hosted by next/font, product images through
//   the /_next/image optimiser (Supabase is fetched server-side), no iframes, no
//   client-side calls to other origins (Paystack is a redirect, its API is
//   server-only).
//
// 'unsafe-inline' for scripts is a known gap: the App Router streams inline
// scripts, and nonces (the only way to drop it) need every page rendered
// dynamically, which Next.js documents as incompatible with this app's Cache
// Components / Partial Prerendering. Styles need it for inline style attributes
// (colour swatches, the global error page). 'unsafe-eval' is development only
// (React's dev tooling); production never needs it.

export const PAYSTACK_CHECKOUT_ORIGIN = "https://checkout.paystack.com";

const policy = (directives: [string, ...string[]][]) => directives.map((d) => d.join(" ")).join("; ");

export function enforcedCsp(): string {
  return policy([
    ["frame-ancestors", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'", PAYSTACK_CHECKOUT_ORIGIN],
  ]);
}

export function reportOnlyCsp(opts: { isDev: boolean }): string {
  return policy([
    ["default-src", "'self'"],
    ["script-src", "'self'", "'unsafe-inline'", ...(opts.isDev ? ["'unsafe-eval'"] : [])],
    ["style-src", "'self'", "'unsafe-inline'"],
    ["img-src", "'self'", "data:", "blob:"],
    ["font-src", "'self'"],
    ["connect-src", "'self'", ...(opts.isDev ? ["ws:"] : [])],
    ["media-src", "'self'"],
    ["manifest-src", "'self'"],
    ["worker-src", "'self'", "blob:"],
    ["frame-src", "'none'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'", PAYSTACK_CHECKOUT_ORIGIN],
    ["frame-ancestors", "'none'"],
  ]);
}

export function securityHeaders(opts: { isDev: boolean }): { key: string; value: string }[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "Content-Security-Policy", value: enforcedCsp() },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyCsp(opts) },
  ];
}
