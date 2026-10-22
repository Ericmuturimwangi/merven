import Link from "next/link";
import { returnsPolicy, site } from "@/content/site";
import { serverEnv } from "@/env";
import { buildContactWhatsAppUrl, formatWhatsAppNumber } from "@/lib/whatsapp";
import { getCategories } from "@/server/catalogue/queries";

export async function SiteFooter() {
  const categories = await getCategories();
  const phone = serverEnv().WHATSAPP_NUMBER;
  return (
    <footer className="mt-24 bg-forest text-ivory">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-10">
        <div>
          <p className="font-display text-3xl font-medium tracking-[0.2em]">MERVEN</p>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-ivory/75">{site.intro}</p>
        </div>
        <nav aria-label="Shop" className="text-sm">
          <h2 className="mb-4 text-xs tracking-[0.12em] text-champagne">SHOP</h2>
          <ul className="space-y-2.5">
            <li><Link href="/shop" className="hover:underline">Shop all</Link></li>
            {categories.map((c) => (
              <li key={c.id}><Link href={`/shop/${c.slug}`} className="hover:underline">{c.name}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Help" className="text-sm">
          <h2 className="mb-4 text-xs tracking-[0.12em] text-champagne">HELP</h2>
          <ul className="space-y-2.5">
            <li><Link href="/delivery" className="hover:underline">How to order</Link></li>
            <li><Link href="/delivery#delivery" className="hover:underline">Delivery in Kenya</Link></li>
            <li><Link href="/search" className="hover:underline">Search</Link></li>
          </ul>
        </nav>
        <div className="text-sm">
          <h2 className="mb-4 text-xs tracking-[0.12em] text-champagne">CONTACT</h2>
          <p>
            WhatsApp{" "}
            <a href={buildContactWhatsAppUrl(phone)} target="_blank" rel="noopener noreferrer" className="underline decoration-champagne underline-offset-4">
              {formatWhatsAppNumber(phone)}
            </a>
          </p>
          <p className="mt-4 leading-relaxed text-ivory/75">
            {returnsPolicy ?? "Returns and exchanges: please check with us on WhatsApp before you order."}
          </p>
        </div>
      </div>
      <div className="border-t border-ivory/15">
        <p className="mx-auto max-w-7xl px-4 py-5 text-xs text-ivory/60 sm:px-6 lg:px-10">
          © {site.name}. Prices in Kenyan shillings (KES). Delivery within Kenya.
        </p>
      </div>
    </footer>
  );
}
