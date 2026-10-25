import { describe, expect, it } from "vitest";
import { enforcedCsp, reportOnlyCsp, securityHeaders } from "@/lib/security-headers";

const directives = (csp: string) => new Map(csp.split("; ").map((d) => { const [name, ...values] = d.split(" "); return [name, values] as const; }));

describe("security headers", () => {
  it("keeps the enforced CSP to directives that can't break the app, allowing only Paystack's checkout as a form target", () => {
    expect(enforcedCsp()).toBe("frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self' https://checkout.paystack.com");
  });

  it("sends a restrictive report-only policy with no wildcard origins", () => {
    const d = directives(reportOnlyCsp({ isDev: false }));
    expect(d.get("default-src")).toEqual(["'self'"]);
    expect(d.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(d.get("connect-src")).toEqual(["'self'"]);
    expect(d.get("frame-src")).toEqual(["'none'"]);
    expect(d.get("object-src")).toEqual(["'none'"]);
    expect(d.get("form-action")).toEqual(["'self'", "https://checkout.paystack.com"]);
    expect(reportOnlyCsp({ isDev: false })).not.toMatch(/\*|unsafe-eval|https?:(?!\/\/checkout\.paystack\.com)/);
  });

  it("allows eval and the HMR socket in development only", () => {
    const dev = directives(reportOnlyCsp({ isDev: true }));
    expect(dev.get("script-src")).toContain("'unsafe-eval'");
    expect(dev.get("connect-src")).toContain("ws:");
  });

  it("sends both CSP headers with the existing hardening headers", () => {
    const keys = securityHeaders({ isDev: false }).map((h) => h.key);
    expect(keys).toEqual([
      "X-Content-Type-Options",
      "X-Frame-Options",
      "Referrer-Policy",
      "Permissions-Policy",
      "Strict-Transport-Security",
      "Content-Security-Policy",
      "Content-Security-Policy-Report-Only",
    ]);
  });
});
