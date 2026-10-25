import Link from "next/link";
import { prefetch } from "next/cache";
import { db } from "@/server/db";
import { orderStatusPath } from "@/server/orders/access";
import { readBag } from "@/server/cart/bag-store";
import { checkoutLinkState, resumableOrder } from "@/server/cart/checkout-link-store";
import { BagSettlement } from "./bag-settlement";

// The visitor's link between their bag and an order started from it: points
// back to an unpaid order for this very bag, and settles the bag once that
// order is paid. Render it inside <Suspense> on /bag and /checkout; it only
// reads, the action writes.
//
// `unpaidNotice`: /bag shows the "continue with that order" notice; /checkout
// leaves it to the checkout review, which shows its own (one notice per page).
// The notice appears only while the order's items match the bag as it is now,
// so an outdated order is never presented as the current bag's checkout.
export async function BagCheckoutStatus({ unpaidNotice = true }: { unpaidNotice?: boolean }) {
  await prefetch(); // per visitor: kept out of the shared App Shell
  const state = await checkoutLinkState(db);
  // Same rule as the checkout: these items, today's price, still payable online.
  const current = unpaidNotice && state.kind === "pending" ? await resumableOrder(db, state, (await readBag()).lines) : null;
  return (
    <>
      {current && (
        <p className="mb-8 border-l-2 border-champagne bg-white px-4 py-3 text-sm leading-relaxed text-ink">
          You started paying for this bag (order {current.reference}), and it isn&rsquo;t paid yet.{" "}
          <Link href={orderStatusPath(current.reference)} className="link-underline inline-flex min-h-11 items-center">
            Continue with that order
          </Link>
        </p>
      )}
      <BagSettlement active={state.kind === "paid" || state.kind === "stale"} />
    </>
  );
}
