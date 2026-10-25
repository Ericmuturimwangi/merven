import type { Metadata } from "next";
import { Suspense } from "react";
import { BagCheckoutStatus } from "@/components/cart/bag-checkout-status";
import { CheckoutContent } from "@/components/checkout/checkout-content";

export const metadata: Metadata = { title: "Checkout", robots: { index: false, follow: false } };

export default function CheckoutPage({ searchParams }: PageProps<"/checkout">) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      <h1 className="mb-8 font-display text-4xl font-medium sm:text-5xl">Checkout</h1>
      {/* Its own boundary, so a settlement notice survives the review re-rendering.
          The unpaid-order notice is the review's own (CheckoutContent), not repeated here. */}
      <Suspense fallback={null}>
        <BagCheckoutStatus unpaidNotice={false} />
      </Suspense>
      <Suspense fallback={<div className="h-64 bg-ivory-deep" aria-label="Loading your order" />}>
        <CheckoutContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
