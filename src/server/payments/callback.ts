import { orderStatusPath } from "../orders/access";
import { verifyAndApply, type PaymentDeps, type VerifyResult } from "../orders/order-service";
import { rateLimit, UNTRUSTED_CLIENT } from "../rate-limit";

// Customer return from Paystack (?reference=…). The redirect itself proves
// nothing: we verify with Paystack server-side, then send the customer to their
// order page, which shows whatever the database says (paid, pending, failed).
//
// Rate limits guard only the Paystack verify call, never the redirect: a
// customer over a limit still lands on their order page (which has its own
// rate-limited "check payment" button), and the webhook and recovery job still
// confirm the payment. Two limits, so neither the client-supplied reference nor
// the client alone decides: per client (platform-verified IP, see clientIp;
// generous because mobile networks share IPs) and per reference (counted only
// for references that exist, so random references create no rows).

const REFERENCE = /^[A-Za-z0-9.=-]{1,100}$/;
const WINDOW_MS = 10 * 60_000;
export const CALLBACK_VERIFY_LIMITS = { perClient: 60, perReference: 10 };

export async function handlePaystackCallback(
  deps: PaymentDeps,
  reference: string | null,
  opts: { client?: string } = {},
): Promise<{ location: string; result?: VerifyResult; limited?: true }> {
  if (!reference || !REFERENCE.test(reference)) return { location: "/checkout/unknown" };
  const clientOk = (await rateLimit(deps.prisma, `callback:client:${opts.client ?? UNTRUSTED_CLIENT}`, { max: CALLBACK_VERIFY_LIMITS.perClient, windowMs: WINDOW_MS })).allowed;
  const attempt = await deps.prisma.paymentAttempt.findUnique({ where: { reference }, select: { order: { select: { reference: true } } } });
  if (!attempt) return { location: "/checkout/unknown" };
  const location = orderStatusPath(attempt.order.reference);
  const referenceOk = (await rateLimit(deps.prisma, `callback:ref:${reference}`, { max: CALLBACK_VERIFY_LIMITS.perReference, windowMs: WINDOW_MS })).allowed;
  if (!clientOk || !referenceOk) {
    console.warn(JSON.stringify({ level: "warn", event: "callback_verify_rate_limited", attempt: reference, by: clientOk ? "reference" : "client" }));
    return { location, limited: true };
  }
  const result = await verifyAndApply(deps, reference); // "unverified" is fine: the page will show "checking"
  return { location, result };
}
