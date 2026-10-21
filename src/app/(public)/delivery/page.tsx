import type { Metadata } from "next";
import { delivery } from "@/content/site";

export const metadata: Metadata = {
  title: "Delivery in Kenya",
  description: "Merven Fashions delivers within Kenya. Delivery times and how ordering via WhatsApp works.",
  alternates: { canonical: "/delivery" },
};

export default function DeliveryPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:py-20">
      <p className="label text-stone">Customer care</p>
      <h1 className="mt-3 font-display text-4xl sm:text-5xl">Delivery in Kenya</h1>
      <p className="mt-6 text-lg text-ink">{delivery.summary}</p>

      <table className="mt-12 w-full border-collapse text-left text-sm">
        <caption className="sr-only">Delivery zones, timings and fees</caption>
        <thead>
          <tr className="border-b border-charcoal">
            <th scope="col" className="label py-3 pr-4 font-medium">Area</th>
            <th scope="col" className="label py-3 pr-4 font-medium">Typical time</th>
            <th scope="col" className="label py-3 font-medium">Fee</th>
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

      <ul className="mt-10 space-y-3 text-ink">
        {delivery.notes.map((n) => (
          <li key={n} className="flex gap-3">
            <span aria-hidden className="text-stone">—</span>
            {n}
          </li>
        ))}
      </ul>
    </div>
  );
}
