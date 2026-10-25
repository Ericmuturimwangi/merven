import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createPaystackClient, PaystackError, verifyWebhookSignature } from "@/server/payments/paystack";

const KEY = "sk_test_0123456789abcdef0123";
type Call = { url: string; init: RequestInit };

function client(respond: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond({ url, init });
  }) as unknown as typeof fetch;
  return { paystack: createPaystackClient({ secretKey: KEY, fetch: fetchFn, timeoutMs: 50 }), calls };
}

const init = {
  email: "amina@example.com",
  amountMinor: 380000,
  currency: "KES" as const,
  reference: "TEST-MRV-ABC-1-XYZ",
  callbackUrl: "https://merven.example/checkout/callback",
  channels: ["card", "mobile_money"],
  metadata: { order: "TEST-MRV-ABC" },
};

const okInit = () =>
  Response.json({ status: true, message: "ok", data: { authorization_url: "https://checkout.paystack.com/abc123", access_code: "abc123", reference: init.reference } });

describe("Paystack initialize", () => {
  it("posts the server-side amount in the smallest unit, with auth, callback and channels", async () => {
    const { paystack, calls } = client(okInit);
    const res = await paystack.initialize(init);
    expect(res).toEqual({ authorizationUrl: "https://checkout.paystack.com/abc123", reference: init.reference });
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/initialize");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      email: init.email,
      amount: 380000,
      currency: "KES",
      reference: init.reference,
      callback_url: init.callbackUrl,
      channels: ["card", "mobile_money"],
      metadata: init.metadata,
    });
  });

  it.each([
    ["a non-Paystack checkout host", { authorization_url: "https://evil.example/pay", access_code: "x", reference: init.reference }],
    ["plain http", { authorization_url: "http://checkout.paystack.com/x", access_code: "x", reference: init.reference }],
    ["a different reference", { authorization_url: "https://checkout.paystack.com/x", access_code: "x", reference: "OTHER" }],
  ])("rejects a response with %s", async (_l, data) => {
    const { paystack } = client(() => Response.json({ status: true, message: "ok", data }));
    await expect(paystack.initialize(init)).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("classifies failures so ambiguous ones are never blindly retried", async () => {
    const cases: [() => Response | Promise<Response>, string, boolean][] = [
      [() => Response.json({ status: false, message: "Invalid key" }, { status: 401 }), "rejected", false],
      [() => Response.json({ status: false }, { status: 502 }), "http", true],
      [() => new Response("<html>", { status: 200 }), "invalid_response", false],
      [() => { throw new TypeError("fetch failed"); }, "network", true],
      [() => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("t"), { name: "TimeoutError" })), 5)), "timeout", true],
    ];
    for (const [respond, kind, ambiguous] of cases) {
      const { paystack } = client(respond);
      const err = await paystack.initialize(init).catch((e) => e);
      expect(err).toBeInstanceOf(PaystackError);
      expect(err).toMatchObject({ kind });
      expect(err.ambiguous).toBe(ambiguous);
    }
  });

  it("refuses non-positive or fractional amounts before calling Paystack", async () => {
    const { paystack, calls } = client(okInit);
    await expect(paystack.initialize({ ...init, amountMinor: 0 })).rejects.toBeInstanceOf(PaystackError);
    await expect(paystack.initialize({ ...init, amountMinor: 10.5 })).rejects.toBeInstanceOf(PaystackError);
    expect(calls).toHaveLength(0);
  });
});

describe("Paystack verify", () => {
  it("parses a verification response", async () => {
    const { paystack, calls } = client(() =>
      Response.json({
        status: true,
        message: "ok",
        data: { id: 519558290, domain: "test", status: "success", reference: "R-1", amount: 380000, currency: "KES", channel: "mobile_money", paid_at: "2026-10-22T10:00:00.000Z", gateway_response: "Approved" },
      }),
    );
    expect(await paystack.verify("R-1")).toEqual({
      id: "519558290",
      domain: "test",
      status: "success",
      reference: "R-1",
      amount: 380000,
      currency: "KES",
      channel: "mobile_money",
      paidAt: "2026-10-22T10:00:00.000Z",
      gatewayResponse: "Approved",
    });
    expect(calls[0].url).toBe("https://api.paystack.co/transaction/verify/R-1");
  });

  it("maps 404 to not_found and rejects unsafe references without a request", async () => {
    const { paystack, calls } = client(() => Response.json({ status: false }, { status: 404 }));
    await expect(paystack.verify("R-1")).rejects.toMatchObject({ kind: "not_found" });
    await expect(paystack.verify("../../balance")).rejects.toMatchObject({ kind: "rejected" });
    expect(calls).toHaveLength(1);
  });

  // The documented "doesn't exist" response (PaystackOSS/openapi, transaction_verify
  // → 404 NotFound) versus failures that must never be read as "doesn't exist".
  it.each([
    ["Paystack's documented 404 body", () => Response.json({ status: false, message: "Entity not found" }, { status: 404 }), "not_found", false],
    ["a 404 with a full error body", () => Response.json({ status: false, message: "Transaction reference not found", type: "validation_error", code: "transaction_not_found", meta: { nextStep: "x" } }, { status: 404 }), "not_found", false],
    ["a 404 that isn't Paystack's JSON (proxy, wrong base URL)", () => new Response("<html>Not Found</html>", { status: 404 }), "invalid_response", true],
    ["a 404 JSON body without status:false", () => Response.json({ error: "not found" }, { status: 404 }), "invalid_response", true],
    ["400 (validation error; body undocumented for verify)", () => Response.json({ status: false, message: "Transaction reference not found" }, { status: 400 }), "rejected", false],
    ["401 bad key", () => Response.json({ status: false, message: "Invalid key" }, { status: 401 }), "rejected", false],
    ["429 rate limit", () => Response.json({ status: false, message: "Too many requests" }, { status: 429 }), "rejected", false],
    ["503 outage", () => Response.json({ status: false }, { status: 503 }), "http", true],
    ["502 gateway HTML", () => new Response("<html>Bad gateway</html>", { status: 502 }), "invalid_response", true],
    ["network failure", () => { throw new TypeError("fetch failed"); }, "network", true],
  ] as [string, () => Response, string, boolean][])("verify: %s", async (_l, respond, kind, ambiguous) => {
    const { paystack } = client(respond);
    const err = await paystack.verify("R-1").catch((e) => e);
    expect(err).toBeInstanceOf(PaystackError);
    expect(err).toMatchObject({ kind });
    expect(err.ambiguous).toBe(ambiguous);
  });
});

describe("webhook signature", () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "R-1" } });
  const sig = createHmac("sha512", KEY).update(body).digest("hex");

  it("accepts the HMAC-SHA512 of the raw body", () => {
    expect(verifyWebhookSignature(body, sig, KEY)).toBe(true);
    expect(verifyWebhookSignature(body, sig.toUpperCase(), KEY)).toBe(true);
  });

  it.each([
    ["missing", null],
    ["empty", ""],
    ["wrong key", createHmac("sha512", "sk_test_other").update(body).digest("hex")],
    ["truncated", sig.slice(0, 64)],
    ["not hex", "z".repeat(128)],
    ["sha256 instead", createHmac("sha256", KEY).update(body).digest("hex")],
  ])("rejects a %s signature", (_l, s) => {
    expect(verifyWebhookSignature(body, s, KEY)).toBe(false);
  });

  it("rejects a valid signature over a modified body (re-serialised JSON)", () => {
    const reserialised = JSON.stringify(JSON.parse(body), null, 1);
    expect(verifyWebhookSignature(reserialised, sig, KEY)).toBe(false);
  });
});
