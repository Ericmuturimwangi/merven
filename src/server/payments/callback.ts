import { orderStatusPath } from "../orders/access";
import { verifyAndApply, type PaymentDeps, type VerifyResult } from "../orders/order-service";

// Customer return from Paystack (?reference=…). The redirect itself proves
// nothing: we verify with Paystack server-side, then send the customer to their
// order page, which shows whatever the database says (paid, pending, failed).

const REFERENCE = /^[A-Za-z0-9.=-]{1,100}$/;

export async function handlePaystackCallback(deps: PaymentDeps, reference: string | null): Promise<{ location: string; result?: VerifyResult }> {
  if (!reference || !REFERENCE.test(reference)) return { location: "/checkout/unknown" };
  const attempt = await deps.prisma.paymentAttempt.findUnique({ where: { reference }, select: { order: { select: { reference: true } } } });
  if (!attempt) return { location: "/checkout/unknown" };
  const result = await verifyAndApply(deps, reference); // "unverified" is fine: the page will show "checking"
  return { location: orderStatusPath(attempt.order.reference), result };
}
