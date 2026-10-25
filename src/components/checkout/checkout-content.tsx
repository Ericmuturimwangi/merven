import Image from "next/image";
import Link from "next/link";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { QuantitySelect } from "@/components/checkout/quantity-select";
import { formatKES } from "@/lib/money";
import { db } from "@/server/db";
import { readBag } from "@/server/cart/bag-store";
import { describeBag } from "@/server/cart/cart-service";
import { checkoutLinkState, resumableOrder } from "@/server/cart/checkout-link-store";
import { orderStatusPath } from "@/server/orders/access";
import { basketParam, MAX_QUANTITY_PER_LINE, parseBasketParam } from "@/server/orders/checkout-input";
import { priceBasket, type BasketProblem } from "@/server/orders/order-service";
import { DELIVERY_NOTE } from "@/server/notifications/receipt";
import { paymentAvailability } from "@/server/payments/runtime";

// Checkout review. Two entry points share it:
// - Buy now: `?items=variantId:qty,…` from a product page (unchanged).
// - Bag: no `?items=`; the basket is the visitor's bag, read on the server. A
//   bag with any line that can't be bought as it is never proceeds with a
//   smaller order: the customer is sent back to the bag to resolve it.
// Either way prices, availability and totals are the server's, and the order
// action re-checks everything.

const PROBLEM_TEXT: Record<BasketProblem["kind"], string> = {
  unavailable: "is no longer available",
  sold_out: "is sold out",
  insufficient_stock: "isn't available in that quantity: please choose fewer",
  quantity_limit: `can be ordered up to ${MAX_QUANTITY_PER_LINE} at a time`,
};

function TestModeBanner() {
  return (
    <p className="mb-8 border border-champagne bg-white px-4 py-3 text-sm text-ink">
      <strong className="font-medium">Test mode.</strong> Payments use Paystack&rsquo;s test environment: no real money is
      taken and no real order is placed.
    </p>
  );
}

const editBagLink = <Link href="/bag" className="link-underline inline-flex min-h-11 items-center text-sm">Edit bag</Link>;

function BagNeedsAttention() {
  return (
    <div className="max-w-xl space-y-4 text-ink">
      <p>Some pieces in your bag can&rsquo;t be ordered as they are: one may be sold out, no longer available, or short of stock.</p>
      <p>Please review your bag before checking out. Nothing has been ordered.</p>
      <Link href="/bag" className="flex min-h-12 items-center justify-center bg-forest px-6 text-sm tracking-wide text-white transition-colors hover:bg-forest-deep sm:inline-flex">
        Review your bag
      </Link>
    </div>
  );
}

export async function CheckoutContent({ searchParams }: { searchParams: PageProps<"/checkout">["searchParams"] }) {
  const sp = await searchParams;
  const payments = await paymentAvailability();
  if (!payments.available) {
    return (
      <div className="max-w-xl space-y-4 text-ink">
        <p>Online payment isn&rsquo;t available yet. To order, choose your piece and tap &ldquo;Enquire on WhatsApp&rdquo; on the product page: we&rsquo;ll confirm availability, delivery and payment with you there.</p>
        <Link href="/shop" className="link-underline text-sm">Back to the shop</Link>
      </div>
    );
  }

  const fromBag = typeof sp.items !== "string";
  const bagLines = fromBag ? (await readBag()).lines : [];
  const basket = fromBag ? bagLines.map(({ variantId, quantity }) => ({ variantId, quantity })) : parseBasketParam(sp.items as string);
  if (basket.length === 0) {
    return (
      <div className="space-y-4 text-ink">
        <p>{fromBag ? "Your bag is empty." : "Your basket is empty."}</p>
        <Link href="/shop" className="link-underline text-sm">Browse the collection</Link>
      </div>
    );
  }

  if (fromBag) {
    if (!(await describeBag(db, bagLines)).ready) return <BagNeedsAttention />;
    const link = await checkoutLinkState(db);
    if (link.kind === "paid") {
      // BagCheckoutStatus settles it; nothing new is ordered meanwhile.
      return <p className="max-w-xl text-ink">Your earlier order from this bag has been paid. We&rsquo;re updating your bag: please check it before ordering again.</p>;
    }
    // Only an order for these items at today's price that can still be paid online;
    // otherwise the review below offers a correctly priced new order.
    const resumable = await resumableOrder(db, link, basket);
    if (resumable) {
      return (
        <div className="max-w-xl space-y-4 text-ink">
          <p>You&rsquo;ve already started checkout for this bag (order {resumable.reference}). Continue with that order rather than starting another, so you&rsquo;re never charged twice.</p>
          <Link href={orderStatusPath(resumable.reference)} className="flex min-h-12 items-center justify-center bg-forest px-6 text-sm tracking-wide text-white transition-colors hover:bg-forest-deep sm:inline-flex">
            Continue with your order
          </Link>
          <div>{editBagLink}</div>
        </div>
      );
    }
  }

  const { lines, problems, subtotalMinor } = await priceBasket(db, basket);
  // Same rules as the bag view; re-checked here in case stock changed in between.
  if (fromBag && (problems.length > 0 || lines.length !== basket.length)) return <BagNeedsAttention />;
  const problemFor = (variantId: string) => problems.find((p) => p.variantId === variantId);
  const unavailable = problems.filter((p) => !lines.some((l) => l.variantId === p.variantId));

  return (
    <>
      {payments.testMode && <TestModeBanner />}
      <div className="grid gap-12 lg:grid-cols-12">
        <section aria-labelledby="review" className="lg:col-span-7">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4">
            <h2 id="review" className="font-display text-2xl">Your order</h2>
            {fromBag && editBagLink}
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {lines.map((l) => {
              const problem = problemFor(l.variantId);
              return (
                <li key={l.variantId} className="flex gap-4 py-5">
                  <div className="relative h-28 w-22 shrink-0 bg-white">
                    {l.image && <Image src={l.image.url} alt={l.image.alt} fill sizes="88px" className="object-cover" />}
                  </div>
                  <div className="flex-1 space-y-1">
                    <Link href={`/products/${l.productSlug}`} className="font-display text-lg hover:underline">{l.productName}</Link>
                    <p className="text-sm text-stone">{l.colour}, size {l.size}</p>
                    <p className="text-sm text-ink">{formatKES(l.unitPriceMinor)} each</p>
                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      {fromBag ? (
                        // Quantities belong to the bag: they're changed there, not in this URL.
                        <span className="text-sm text-stone">Qty {l.quantity}</span>
                      ) : (
                        <QuantitySelect variantId={l.variantId} quantity={l.quantity} max={MAX_QUANTITY_PER_LINE} basket={basket} />
                      )}
                      <span className="text-sm font-medium">{formatKES(l.lineTotalMinor)}</span>
                    </div>
                    {problem && <p role="alert" className="text-sm text-danger">This item {PROBLEM_TEXT[problem.kind]}.</p>}
                  </div>
                </li>
              );
            })}
          </ul>
          {unavailable.length > 0 && (
            <p role="alert" className="mt-4 text-sm text-danger">
              {unavailable.length === 1 ? "One item" : `${unavailable.length} items`} in your basket {unavailable.length === 1 ? "is" : "are"} no longer available and {unavailable.length === 1 ? "was" : "were"} removed from this review.
            </p>
          )}
          <dl className="mt-6 space-y-2 text-sm">
            <div className="flex justify-between">
              <dt>Products subtotal</dt>
              <dd className="font-medium">{formatKES(subtotalMinor)}</dd>
            </div>
            <div className="flex justify-between text-stone">
              <dt>Delivery</dt>
              <dd>Not included</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-3 text-base">
              <dt className="font-medium">To pay now</dt>
              <dd className="font-medium">{formatKES(subtotalMinor)}</dd>
            </div>
          </dl>
          <p className="mt-4 border-l-2 border-forest bg-white px-4 py-3 text-sm leading-relaxed text-ink">{DELIVERY_NOTE}</p>
        </section>

        <section aria-labelledby="details" className="lg:col-span-5">
          <h2 id="details" className="mb-4 font-display text-2xl">Your details</h2>
          {problems.length > 0 || lines.length === 0 ? (
            <p className="text-sm text-ink">Please fix the items marked above before paying.</p>
          ) : (
            <CheckoutForm items={basketParam(lines)} totalMinor={subtotalMinor} testMode={payments.testMode} source={fromBag ? "bag" : undefined} />
          )}
          <p className="mt-6 text-sm text-stone">
            Prefer to order by chat? Every product page has an &ldquo;Enquire on WhatsApp&rdquo; button.
          </p>
        </section>
      </div>
    </>
  );
}
