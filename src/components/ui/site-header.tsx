import Link from "next/link";
import { getCategories } from "@/server/catalogue/queries";
import { MobileNav } from "./mobile-nav";

export async function SiteHeader() {
  const categories = await getCategories();
  const links = [
    { href: "/shop", label: "Shop all" },
    ...categories.map((c) => ({ href: `/shop/${c.slug}`, label: c.name })),
  ];
  return (
    <header className="relative border-b border-line bg-ivory">
      <div className="mx-auto grid h-16 max-w-7xl grid-cols-[1fr_auto_1fr] items-center px-4 sm:px-6 lg:flex lg:h-20 lg:justify-between lg:gap-8 lg:px-10">
        <MobileNav
          links={[...links, { href: "/search", label: "Search" }, { href: "/delivery", label: "Delivery & ordering" }]}
        />
        <Link href="/" className="justify-self-center text-center leading-none" aria-label="Merven Fashions home">
          <span className="block font-display text-[1.7rem] font-medium tracking-[0.2em] lg:text-[2rem]">MERVEN</span>
          <span className="mt-0.5 block text-[0.6rem] tracking-[0.35em] text-stone">FASHIONS</span>
        </Link>
        <nav aria-label="Main" className="hidden flex-1 justify-center gap-7 text-sm lg:flex">
          {links.slice(0, 7).map((l) => (
            <Link key={l.href} href={l.href} className="py-2 text-ink transition-colors hover:text-forest">
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center justify-self-end gap-5 text-sm">
          <Link href="/delivery" className="hidden py-2 text-ink hover:text-forest xl:inline">
            Delivery
          </Link>
          <Link href="/search" className="py-2 text-ink hover:text-forest" aria-label="Search the catalogue">
            Search
          </Link>
        </div>
      </div>
    </header>
  );
}
