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
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:h-20 lg:px-10">
        <MobileNav links={[...links, { href: "/delivery", label: "Delivery" }]} />
        <Link href="/" className="font-display text-2xl tracking-[0.18em] lg:text-3xl" aria-label="Merven Fashions home">
          MERVEN
        </Link>
        <nav aria-label="Main" className="hidden flex-1 justify-center gap-7 text-sm lg:flex">
          {links.slice(0, 7).map((l) => (
            <Link key={l.href} href={l.href} className="text-ink hover:underline hover:underline-offset-4">
              {l.label}
            </Link>
          ))}
        </nav>
        <Link href="/search" className="text-sm hover:underline hover:underline-offset-4" aria-label="Search the catalogue">
          Search
        </Link>
      </div>
    </header>
  );
}
