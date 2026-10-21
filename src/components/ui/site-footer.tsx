import Link from "next/link";
import { delivery, site } from "@/content/site";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-line bg-ivory-deep">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-3 lg:px-10">
        <div>
          <p className="font-display text-2xl tracking-[0.18em]">MERVEN</p>
          <p className="mt-3 max-w-xs text-sm text-stone">{site.tagline}</p>
        </div>
        <div className="text-sm">
          <p className="label mb-3 text-stone">Visit</p>
          <ul className="space-y-2">
            <li><Link href="/shop" className="hover:underline">Shop all</Link></li>
            <li><Link href="/search" className="hover:underline">Search</Link></li>
            <li><Link href="/delivery" className="hover:underline">Delivery in Kenya</Link></li>
          </ul>
        </div>
        <div className="text-sm">
          <p className="label mb-3 text-stone">Ordering</p>
          <p className="max-w-xs text-stone">
            Enquire about any piece on WhatsApp. {delivery.summary}
          </p>
        </div>
      </div>
      <div className="border-t border-line">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-stone sm:px-6 lg:px-10">
          © {site.name}. Prices in Kenyan shillings (KES).
        </p>
      </div>
    </footer>
  );
}
