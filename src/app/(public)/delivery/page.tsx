import type { Metadata } from "next";
import { delivery, ordering, returnsPolicy } from "@/content/site";
import { serverEnv } from "@/env";
import { buildContactWhatsAppUrl, formatWhatsAppNumber } from "@/lib/whatsapp";

export const metadata: Metadata = {
  title: "Delivery & ordering",
  description: "How to order from Merven Fashions on WhatsApp, and delivery within Kenya.",
  alternates: { canonical: "/delivery" },
};

export default function DeliveryPage() {
  const phone = serverEnv().WHATSAPP_NUMBER;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-20">
      <h1 className="font-display text-4xl font-medium sm:text-5xl">Delivery &amp; ordering</h1>
      <p className="mt-5 text-lg leading-relaxed text-ink">
        We take orders on WhatsApp, so you can check sizes and availability with us before you pay.
      </p>

      <section aria-labelledby="order" className="mt-14">
        <h2 id="order" className="font-display text-3xl font-medium">How to order</h2>
        <ol className="mt-6 space-y-6">
          {ordering.steps.map((s, i) => (
            <li key={s.title} className="grid grid-cols-[2.5rem_1fr] gap-2 border-t border-line pt-5">
              <span aria-hidden className="font-display text-2xl text-forest">{i + 1}</span>
              <div>
                <h3 className="font-medium">{s.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-ink">{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="delivery-heading" id="delivery" className="mt-14 scroll-mt-24">
        <h2 id="delivery-heading" className="font-display text-3xl font-medium">Delivery</h2>
        <p className="mt-4 text-ink">{delivery.summary}</p>
        {delivery.zones.length > 0 && (
          <table className="mt-8 w-full border-collapse text-left text-sm">
            <caption className="sr-only">Delivery areas, timings and fees</caption>
            <thead>
              <tr className="border-b border-charcoal">
                <th scope="col" className="py-3 pr-4 font-medium">Area</th>
                <th scope="col" className="py-3 pr-4 font-medium">Typical time</th>
                <th scope="col" className="py-3 font-medium">Fee</th>
              </tr>
            </thead>
            <tbody>
              {delivery.zones.map((z) => (
                <tr key={z.name} className="border-b border-line align-top">
                  <th scope="row" className="py-4 pr-4 font-normal">{z.name}</th>
                  <td className="py-4 pr-4 text-ink">{z.time}</td>
                  <td className="py-4 text-ink">{z.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ul className="mt-6 space-y-3 text-ink">
          {delivery.notes.map((n) => (
            <li key={n} className="flex gap-3">
              <span aria-hidden className="text-champagne">—</span>
              {n}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="returns" className="mt-14">
        <h2 id="returns" className="font-display text-3xl font-medium">Returns &amp; exchanges</h2>
        <p className="mt-4 text-ink">{returnsPolicy ?? "Please check returns and exchanges with us on WhatsApp before you order."}</p>
      </section>

      <section aria-labelledby="contact" className="mt-14 border-t border-line pt-8">
        <h2 id="contact" className="text-sm font-medium">Questions?</h2>
        <p className="mt-2 text-ink">
          Message us on WhatsApp at{" "}
          <a href={buildContactWhatsAppUrl(phone)} target="_blank" rel="noopener noreferrer" className="link-underline text-forest">
            {formatWhatsAppNumber(phone)}
          </a>
          .
        </p>
      </section>
    </div>
  );
}
