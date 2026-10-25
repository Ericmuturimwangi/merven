import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

// Minimal Paystack REST client (https://api.paystack.co). Server-only: it holds
// the secret key. Amounts are sent in the currency's smallest unit, which is
// how this app already stores money (KES cents), so no conversion happens.
// Sources: PaystackOSS/openapi (transaction_initialize, transaction_verify) and
// PaystackOSS/doc-code-snippets (webhook signature: hex HMAC-SHA512 of the raw
// body keyed with the secret key, header `x-paystack-signature`).

export type PaystackErrorKind = "network" | "timeout" | "http" | "invalid_response" | "not_found" | "rejected";

export class PaystackError extends Error {
  constructor(
    readonly kind: PaystackErrorKind,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "PaystackError";
  }
  /** True when the request may or may not have reached Paystack. */
  get ambiguous() {
    return (
      this.kind === "network" ||
      this.kind === "timeout" ||
      // 5xx, even with a non-JSON body (e.g. a gateway's error page): outcome unknown.
      (this.httpStatus ?? 0) >= 500 ||
      // A 404 without Paystack's error body may not have come from Paystack at all.
      (this.kind === "invalid_response" && this.httpStatus === 404)
    );
  }
}

export type PaystackTransaction = {
  id: string;
  domain: string; // "test" | "live"
  status: string; // success | failed | abandoned | reversed | ongoing | pending | …
  reference: string;
  amount: number; // smallest currency unit
  currency: string;
  channel: string | null;
  paidAt: string | null;
  gatewayResponse: string | null;
};

const initializeResponse = z.object({
  status: z.literal(true),
  data: z.object({ authorization_url: z.string(), access_code: z.string(), reference: z.string() }),
});

const verifyResponse = z.object({
  status: z.literal(true),
  data: z.object({
    id: z.union([z.number(), z.string()]),
    domain: z.string(),
    status: z.string(),
    reference: z.string(),
    amount: z.number().int(),
    currency: z.string(),
    channel: z.string().nullish(),
    paid_at: z.string().nullish(),
    gateway_response: z.string().nullish(),
  }),
});

export const PAYSTACK_CHECKOUT_HOST = "checkout.paystack.com";

export type InitializeInput = {
  email: string;
  amountMinor: number;
  currency: "KES";
  reference: string;
  callbackUrl: string;
  channels: string[];
  metadata: Record<string, string>;
};

export type PaystackClient = {
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<PaystackTransaction>;
};

export function createPaystackClient(opts: {
  secretKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}): PaystackClient {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? "https://api.paystack.co";
  const timeoutMs = opts.timeoutMs ?? 10_000;

  async function call(path: string, init: RequestInit): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        ...init,
        headers: { Authorization: `Bearer ${opts.secretKey}`, "Content-Type": "application/json", ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
        cache: "no-store",
      });
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      throw new PaystackError(timedOut ? "timeout" : "network", timedOut ? "Paystack request timed out" : "Could not reach Paystack");
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      throw new PaystackError("invalid_response", "Paystack returned a non-JSON response", res.status);
    }
    // "Doesn't exist" only when Paystack itself says so: HTTP 404 with its error
    // body ({ status: false, message }). Documented: the API errors page (404 =
    // "the request resource doesn't exist") and PaystackOSS/openapi for verify
    // (404 NotFound, "Entity not found"). A bare 404 (proxy, wrong base URL) is
    // not proof, and 400 (validation), 401 (key), 429 and 5xx never mean "not found".
    if (res.status === 404) {
      const paystackError = typeof body === "object" && body !== null && (body as { status?: unknown }).status === false;
      if (paystackError) throw new PaystackError("not_found", "Transaction not found", 404);
      throw new PaystackError("invalid_response", "Unexpected 404 response", 404);
    }
    if (!res.ok) {
      // 4xx: Paystack refused the request; 5xx: outcome unknown.
      throw new PaystackError(res.status >= 500 ? "http" : "rejected", `Paystack responded with HTTP ${res.status}`, res.status);
    }
    return body;
  }

  return {
    async initialize(input) {
      if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new PaystackError("rejected", "Invalid amount");
      const body = await call("/transaction/initialize", {
        method: "POST",
        body: JSON.stringify({
          email: input.email,
          amount: input.amountMinor,
          currency: input.currency,
          reference: input.reference,
          callback_url: input.callbackUrl,
          channels: input.channels,
          metadata: input.metadata,
        }),
      });
      const parsed = initializeResponse.safeParse(body);
      if (!parsed.success) throw new PaystackError("invalid_response", "Unexpected initialize response");
      const { authorization_url, reference } = parsed.data.data;
      if (reference !== input.reference) throw new PaystackError("invalid_response", "Initialize returned a different reference");
      let url: URL;
      try {
        url = new URL(authorization_url);
      } catch {
        throw new PaystackError("invalid_response", "Invalid authorization URL");
      }
      if (url.protocol !== "https:" || url.hostname !== PAYSTACK_CHECKOUT_HOST) {
        throw new PaystackError("invalid_response", "Authorization URL is not a Paystack checkout URL");
      }
      return { authorizationUrl: url.toString(), reference };
    },

    async verify(reference) {
      if (!/^[A-Za-z0-9.=-]{1,100}$/.test(reference)) throw new PaystackError("rejected", "Invalid reference");
      const body = await call(`/transaction/verify/${encodeURIComponent(reference)}`, { method: "GET" });
      const parsed = verifyResponse.safeParse(body);
      if (!parsed.success) throw new PaystackError("invalid_response", "Unexpected verify response");
      const d = parsed.data.data;
      return {
        id: String(d.id),
        domain: d.domain,
        status: d.status,
        reference: d.reference,
        amount: d.amount,
        currency: d.currency,
        channel: d.channel ?? null,
        paidAt: d.paid_at ?? null,
        gatewayResponse: d.gateway_response ?? null,
      };
    },
  };
}

/** Timing-safe check of `x-paystack-signature` against the raw request body. */
export function verifyWebhookSignature(rawBody: string, signature: string | null, secretKey: string): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac("sha512", secretKey).update(rawBody, "utf8").digest();
  const given = Buffer.from(signature, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
