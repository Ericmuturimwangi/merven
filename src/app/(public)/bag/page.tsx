import type { Metadata } from "next";
import { Suspense } from "react";
import { BagCheckoutStatus } from "@/components/cart/bag-checkout-status";
import { BagContents } from "@/components/cart/bag-contents";

export const metadata: Metadata = { title: "Your bag", robots: { index: false, follow: false } };

const HEADING_ID = "bag-heading";

export default function BagPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-10 lg:py-14">
      {/* Focusable so focus has somewhere sensible to go after a line is removed. */}
      <h1 id={HEADING_ID} tabIndex={-1} className="mb-8 font-display text-4xl font-medium sm:text-5xl">
        Your bag
      </h1>
      {/* Its own boundary, so a settlement notice survives the bag re-rendering. */}
      <Suspense fallback={null}>
        <BagCheckoutStatus />
      </Suspense>
      <Suspense
        fallback={
          <div role="status" className="h-64 bg-ivory-deep">
            <span className="sr-only">Loading your bag</span>
          </div>
        }
      >
        <BagContents headingId={HEADING_ID} />
      </Suspense>
    </div>
  );
}
