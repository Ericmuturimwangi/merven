import { after } from "next/server";
import { afterPaymentChange, paymentDeps } from "@/server/payments/runtime";
import { handlePaystackWebhook } from "@/server/payments/webhook";

// Paystack webhook (configure in the Paystack dashboard, test mode:
// https://<site>/api/webhooks/paystack). The raw body is read as text so the
// HMAC signature is checked over exactly the bytes Paystack signed.
export async function POST(request: Request) {
  const deps = await paymentDeps();
  if (!deps) return new Response("payments disabled", { status: 503 });
  const rawBody = await request.text();
  if (rawBody.length > 100_000) return new Response("payload too large", { status: 413 });
  const res = await handlePaystackWebhook(deps, rawBody, request.headers.get("x-paystack-signature"));
  if (res.result && res.result.outcome !== "unverified") {
    const result = res.result;
    after(() => afterPaymentChange(result, { revalidate: true }));
  }
  return new Response(res.body, { status: res.status });
}
