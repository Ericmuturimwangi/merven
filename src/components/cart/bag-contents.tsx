import Image from "next/image";
import Link from "next/link";
import { prefetch } from "next/cache";
import { delivery } from "@/content/site";
import { serverEnv } from "@/env";
import { formatKES } from "@/lib/money";
import { buildCartWhatsAppUrl } from "@/lib/whatsapp";
import { db } from "@/server/db";
import { readBag } from "@/server/cart/bag-store";
import { describeBag, type BagViewLine } from "@/server/cart/cart-service";
import { paymentAvailability } from "@/server/payments/runtime";
import { BagAnnouncer, BagLineControls } from "./bag-line-controls";

// The visitor's bag, rendered on the server from the bag cookie and current
// catalogue data. The cookie only says which pieces and how many: names,
// prices, stock and totals come from the database. Lines that can no longer be
// bought stay listed with an explanation until the customer removes them.
// Nothing here creates an order; online payment only decides whether Checkout is offered.

const primaryButton =
  "flex min-h-12 w-full items-center justify-center bg-forest px-6 text-center text-sm tracking-wide text-white transition-colors hover:bg-forest-deep";
const secondaryButton =
  "flex min-h-12 w-full items-center justify-center border border-charcoal px-6 text-center text-sm tracking-wide transition-colors hover:bg-white";

/** Why a line can't be bought as it is, in words (never colour alone). */
function statusNote(line: BagViewLine): { text: string; problem: boolean } | null {
  switch (line.status) {
    case "insufficient_stock":
      return { text: `Only ${line.maxQuantity} available. Please reduce the quantity.`, problem: true };
    case "sold_out":
      return { text: "Sold out.", problem: true };
    case "unavailable":
      return { text: "This item is no longer available.", problem: true };
    case "not_found":
      return { text: "This item is no longer listed.", problem: true };
    default:
      return line.lowStock ? { text: "Only a few left.", problem: false } : null;
  }
}

/** The product page exists only while the piece is on sale (published); otherwise the name is plain text. */
const onSale = (line: BagViewLine) => line.status === "available" || line.status === "insufficient_stock" || line.status === "sold_out";

function BagLine({ line }: { line: BagViewLine }) {
  const d = line.display;
  const label = d?.productName ?? "this item";
  const note = statusNote(line);
  return (
    <li className="flex gap-4 py-6">
      <div className="relative h-32 w-24 shrink-0 overflow-hidden bg-white">
        {/* Decorative: the product name is right beside it. */}
        {d?.image ? <Image src={d.image.url} alt="" fill sizes="96px" className="object-cover" /> : <div className="absolute inset-0 bg-ivory-deep" />}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h3 className="min-w-0 break-words font-display text-xl leading-snug">
            {d ? (
              onSale(line) ? (
                <Link href={`/products/${d.productSlug}`} className="hover:underline hover:decoration-1 hover:underline-offset-4">
                  {d.productName}
                </Link>
              ) : (
                d.productName
              )
            ) : (
              "Item no longer listed"
            )}
          </h3>
          {line.lineTotalMinor != null && line.status === "available" && <p className="text-sm font-medium tabular-nums">{formatKES(line.lineTotalMinor)}</p>}
        </div>
        {d && (
          <p className="text-sm text-stone">
            {d.colour}, size {d.size}
          </p>
        )}
        {line.unitPriceMinor != null && <p className="text-sm text-ink">{formatKES(line.unitPriceMinor)} each</p>}
        {note && <p className={`text-sm ${note.problem ? "text-danger" : "text-ink"}`}>{note.text}</p>}
        {line.priceChanged && line.seenUnitPriceMinor != null && line.unitPriceMinor != null && (
          <p className="border-l-2 border-champagne bg-white px-3 py-2 text-sm text-ink">
            The price has changed from {formatKES(line.seenUnitPriceMinor)} to {formatKES(line.unitPriceMinor)} since you added this item.
          </p>
        )}
        <div className="pt-1">
          <BagLineControls variantId={line.variantId} label={label} quantity={line.quantity} maxQuantity={line.maxQuantity} priceChanged={line.priceChanged} />
        </div>
      </div>
    </li>
  );
}

function EmptyBag({ discarded }: { discarded: boolean }) {
  return (
    <div className="max-w-xl space-y-5 text-ink">
      {discarded && <p className="text-sm">Some items in your bag couldn&rsquo;t be restored, so it has been emptied.</p>}
      <p className="font-display text-2xl text-charcoal">Your bag is empty.</p>
      <p className="leading-relaxed">
        Choose a colour and size on any piece and add it to your bag. You can then send us your whole bag on WhatsApp, and we&rsquo;ll
        confirm availability and delivery with you.
      </p>
      <Link href="/shop" className={`${primaryButton} sm:w-auto sm:inline-flex`}>
        Browse the collection
      </Link>
    </div>
  );
}

export async function BagContents({ headingId }: { headingId: string }) {
  // Per-visitor: kept out of the shared App Shell that header links prefetch.
  await prefetch();
  const { lines, discarded } = await readBag(); // an invalid cookie reads as an empty bag
  if (lines.length === 0) return <EmptyBag discarded={discarded} />;

  const view = await describeBag(db, lines);
  const items = view.lines.reduce((n, l) => n + l.quantity, 0);
  const whatsappUrl = buildCartWhatsAppUrl(
    serverEnv().WHATSAPP_NUMBER,
    view.lines.map((l) => ({
      productName: l.display?.productName ?? null,
      colour: l.display?.colour ?? null,
      size: l.display?.size ?? null,
      quantity: l.quantity,
      unitPriceMinor: l.unitPriceMinor,
      status: l.status,
      maxQuantity: l.maxQuantity,
    })),
    view.subtotalMinor,
  );
  // Visibility only: checkout and the order action enforce the payment gate and re-check the bag themselves.
  const payments = await paymentAvailability();
  const canCheckout = payments.available && view.ready;

  return (
    <BagAnnouncer headingId={headingId}>
      <div className="grid gap-12 lg:grid-cols-12">
        <section aria-labelledby="bag-items" className="lg:col-span-7">
          <h2 id="bag-items" className="sr-only">
            Items
          </h2>
          <p className="text-sm text-stone">
            {items} {items === 1 ? "item" : "items"}
          </p>
          {discarded && <p className="mt-2 text-sm text-ink">Some items in your bag couldn&rsquo;t be restored and have been left out.</p>}
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {view.lines.map((line) => (
              <BagLine key={line.variantId} line={line} />
            ))}
          </ul>
        </section>

        <section aria-labelledby="bag-summary" className="lg:col-span-5">
          <h2 id="bag-summary" className="mb-4 font-display text-2xl">
            Summary
          </h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt>Subtotal</dt>
              <dd className="font-medium tabular-nums">{formatKES(view.subtotalMinor)}</dd>
            </div>
            <div className="flex justify-between gap-4 text-stone">
              <dt>Delivery</dt>
              <dd>Not included</dd>
            </div>
          </dl>
          {!view.ready && <p className="mt-3 text-sm text-ink">Items marked above aren&rsquo;t included in the subtotal.</p>}
          <p className="mt-4 border-l-2 border-forest bg-white px-4 py-3 text-sm leading-relaxed text-ink">{delivery.bagNote}</p>

          <div className="mt-6 space-y-3">
            {canCheckout && (
              <Link href="/checkout" className={primaryButton}>
                Go to checkout{payments.testMode ? " (test mode)" : ""}
              </Link>
            )}
            {payments.available && !view.ready && <p className="text-sm text-ink">To pay online, first resolve the items marked above.</p>}
            {whatsappUrl ? (
              <>
                <a href={whatsappUrl} target="_blank" rel="noopener noreferrer" aria-describedby="bag-whatsapp-note" className={canCheckout ? secondaryButton : primaryButton}>
                  Send this bag to us on WhatsApp
                </a>
                <p id="bag-whatsapp-note" className="text-xs leading-relaxed text-stone">
                  Opens WhatsApp with your bag written in, including any items marked above. Nothing is sent until you press send. An
                  enquiry isn&rsquo;t an order: we&rsquo;ll confirm availability, delivery and payment with you first.
                </p>
              </>
            ) : (
              <p className="text-sm text-ink">There&rsquo;s nothing in your bag we can enquire about. Remove the items above to start again.</p>
            )}
            <Link href="/shop" className="link-underline inline-flex min-h-11 items-center text-sm">
              Continue shopping
            </Link>
          </div>
        </section>
      </div>
    </BagAnnouncer>
  );
}
