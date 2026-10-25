import { describe, expect, it } from "vitest";
import { clientIp, UNTRUSTED_CLIENT } from "@/server/rate-limit";

// The rate-limit subject comes only from headers Vercel sets (and overwrites);
// anything a client can send is ignored.

const onVercel = { VERCEL: "1" };
const h = (entries: Record<string, string>) => new Headers(entries);

describe("clientIp", () => {
  it("uses Vercel's x-vercel-forwarded-for on Vercel", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "197.232.10.4", "x-real-ip": "197.232.10.4" }), onVercel)).toBe("197.232.10.4");
    expect(clientIp(h({ "x-vercel-forwarded-for": "2c0f:fe38:2000::1" }), onVercel)).toBe("2c0f:fe38:2000::1");
  });

  it("falls back to x-real-ip (also set by Vercel)", () => {
    expect(clientIp(h({ "x-real-ip": "41.90.1.2" }), onVercel)).toBe("41.90.1.2");
  });

  it("never reads X-Forwarded-For, so a spoofed value can't pick a fresh bucket", () => {
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4" }), onVercel)).toBe(UNTRUSTED_CLIENT);
    expect(clientIp(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "41.90.1.2" }), onVercel)).toBe("41.90.1.2");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 41.90.1.2", "x-vercel-forwarded-for": "41.90.1.2" }), onVercel)).toBe("41.90.1.2");
  });

  it("refuses a list or a non-IP value instead of taking part of it", () => {
    expect(clientIp(h({ "x-vercel-forwarded-for": "6.6.6.6, 41.90.1.2" }), onVercel)).toBe(UNTRUSTED_CLIENT);
    expect(clientIp(h({ "x-real-ip": "attacker-chosen" }), onVercel)).toBe(UNTRUSTED_CLIENT);
    expect(clientIp(h({ "x-real-ip": "" }), onVercel)).toBe(UNTRUSTED_CLIENT);
  });

  it("uses one shared bucket when headers are missing", () => {
    expect(clientIp(h({}), onVercel)).toBe(UNTRUSTED_CLIENT);
  });

  it("trusts no header off Vercel (local dev, another host or proxy)", () => {
    const all = h({ "x-vercel-forwarded-for": "41.90.1.2", "x-real-ip": "41.90.1.2", "x-forwarded-for": "41.90.1.2" });
    expect(clientIp(all, {})).toBe(UNTRUSTED_CLIENT);
    expect(clientIp(all, { VERCEL: "true" })).toBe(UNTRUSTED_CLIENT);
  });
});
