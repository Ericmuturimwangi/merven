import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CheckPaymentButton, RetryPaymentButton } from "@/components/checkout/order-actions";
import { formatKES } from "@/lib/money";
import { db } from "@/server/db";
import { verifyOrderAccess } from "@/server/orders/access";
import { getCustomerOrder } from "@/server/orders/order-service";
import { DELIVERY_NOTE } from "@/server/notifications/receipt";

export const metadata: Metadata = { title: "Your order", robots: { index: false, follow: false } };

const HEADINGS = {
  paid: "Payment confirmed. Thank you.",
  pending: "Waiting for your payment to be confirmed",
  failed: "Your payment didn't go through",
  unknown: "We're checking your payment",
} as const;

async function OrderStatus({ params, searchParams }: PageProps<"/checkout/order/[reference]">) {
  const [{ reference }, sp] = await Promise.all([params, searchParams]);
  const token = typeof sp.token === "string" ? sp.token : null;
  // Without the right token the order simply doesn't exist (no information leak).
  if (!verifyOrderAccess(reference, token)) notFound();
  const order = await getCustomerOrder(db, reference);
  if (!order || !token) notFound();

  return (
    <div className="space-y-8">
      {order.testMode && (
        <p className="border border-champagne bg-white px-4 py-3 text-sm">
          <strong className="font-medium">Test order.</strong> No real money was taken.
        </p>
      )}
      <div>
        <p className="text-sm text-stone">Order {order.reference}</p>
        <h1 className="mt-2 font-display text-4xl font-medium" aria-live="polite">{HEADINGS[order.state]}</h1>
      </div>

      {order.state === "paid" && (
        <div className="space-y-2 text-ink">
          <p>We&rsquo;ve received {formatKES(order.totalMinor)}. {order.receiptStatus === "SENT" ? "A receipt has been sent to your email." : "Your email receipt is on its way."}</p>
          <p className="border-l-2 border-forest bg-white px-4 py-3 text-sm">{DELIVERY_NOTE}</p>
        </div>
      )}
      {order.state === "pending" && (
        <div className="space-y-4 text-ink">
          <p>If you&rsquo;re paying by M-PESA, approve the prompt on your phone. This page doesn&rsquo;t update on its own: check again after you&rsquo;ve paid. Nothing is charged twice by checking.</p>
          <div className="flex flex-wrap gap-4">
            <CheckPaymentButton reference={order.reference} token={token} />
            {order.latestPayment?.authorizationUrl && (
              <a href={order.latestPayment.authorizationUrl} className="inline-flex min-h-11 items-center bg-forest px-5 text-sm text-white hover:bg-forest-deep">
                Continue to Paystack
              </a>
            )}
          </div>
        </div>
      )}
      {order.state === "failed" && (
        <div className="space-y-4 text-ink">
          <p>No payment was taken for this attempt. You can try again; if your card or M-PESA account was charged, contact us on WhatsApp with order {order.reference} before paying again.</p>
          <RetryPaymentButton reference={order.reference} token={token} />
        </div>
      )}
      {order.state === "unknown" && (
        <div className="space-y-4 text-ink">
          <p>We couldn&rsquo;t confirm this payment with Paystack yet. Please don&rsquo;t pay again until it&rsquo;s confirmed. Check again in a minute.</p>
          <CheckPaymentButton reference={order.reference} token={token} />
        </div>
      )}

      <section aria-labelledby="items" className="border-t border-line pt-6">
        <h2 id="items" className="mb-3 text-sm font-medium">Items</h2>
        <ul className="space-y-2 text-sm">
          {order.items.map((i) => (
            <li key={`${i.productSlug}-${i.size}-${i.colour}`} className="flex justify-between gap-4">
              <span>{i.quantity} × {i.productName} <span className="text-stone">({i.colour}, {i.size})</span></span>
              <span>{formatKES(i.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 flex justify-between border-t border-line pt-3 text-sm font-medium">
          <span>{order.state === "paid" ? "Paid" : "Total"} (delivery not included)</span>
          <span>{formatKES(order.totalMinor)}</span>
        </p>
      </section>
      <p className="text-sm text-stone">Keep this page&rsquo;s link to come back to your order.</p>
      <Link href="/shop" className="link-underline text-sm">Continue shopping</Link>
    </div>
  );
}

export default function OrderStatusPage(props: PageProps<"/checkout/order/[reference]">) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6 lg:py-16">
      <Suspense fallback={<div className="h-48 bg-ivory-deep" aria-label="Loading your order" />}>
        <OrderStatus {...props} />
      </Suspense>
    </div>
  );
}
