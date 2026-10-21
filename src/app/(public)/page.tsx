import Image from "next/image";
import Link from "next/link";
import { ProductGrid } from "@/components/catalogue/product-card";
import { delivery, site } from "@/content/site";
import { getCategories, getFeaturedProducts } from "@/server/catalogue/queries";

export default async function HomePage() {
  const [featured, categories] = await Promise.all([getFeaturedProducts(8), getCategories()]);
  const hero = featured[0]?.image;
  const secondary = featured[1]?.image;

  return (
    <>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 pt-10 sm:px-6 md:grid-cols-12 md:items-end md:gap-10 lg:px-10 lg:pt-16">
        <div className="md:col-span-5 md:pb-10">
          <p className="label text-stone">New season · Kenya</p>
          <h1 className="mt-5 font-display text-5xl leading-[1.02] sm:text-6xl lg:text-7xl">
            Dressed with <em className="italic">intention</em>.
          </h1>
          <p className="mt-6 max-w-sm text-base leading-relaxed text-ink">{site.tagline} Each piece is chosen for fit, fabric and how it feels to wear.</p>
          <Link
            href="/shop"
            className="mt-8 inline-block border border-charcoal px-7 py-3 text-sm tracking-wide transition-colors hover:bg-charcoal hover:text-ivory"
          >
            Explore the collection
          </Link>
        </div>
        <div className="grid grid-cols-5 gap-3 md:col-span-7 md:gap-4">
          {hero && (
            <div className="relative col-span-5 aspect-[4/5] bg-ivory-deep sm:col-span-3">
              <Image src={hero.url} alt={hero.alt} fill priority sizes="(min-width: 768px) 35vw, 100vw" className="object-cover" />
            </div>
          )}
          {secondary && (
            <div className="relative hidden aspect-[3/4] self-end bg-ivory-deep sm:col-span-2 sm:block">
              <Image src={secondary.url} alt={secondary.alt} fill sizes="25vw" className="object-cover" />
            </div>
          )}
        </div>
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="edit-heading" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-10">
          <div className="mb-10 flex items-end justify-between gap-6 border-b border-line pb-5">
            <h2 id="edit-heading" className="font-display text-3xl sm:text-4xl">
              The Edit
            </h2>
            <Link href="/shop" className="link-underline text-sm">
              View all
            </Link>
          </div>
          <ProductGrid products={featured} />
        </section>
      )}

      {categories.length > 0 && (
        <section aria-labelledby="categories-heading" className="bg-paper py-20">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-10">
            <h2 id="categories-heading" className="label text-stone">
              Shop by category
            </h2>
            <ul className="mt-8 divide-y divide-line border-y border-line">
              {categories.map((c) => (
                <li key={c.id}>
                  <Link href={`/shop/${c.slug}`} className="group flex items-baseline justify-between gap-6 py-6">
                    <span className="font-display text-3xl transition-[letter-spacing] duration-300 group-hover:italic sm:text-5xl">
                      {c.name}
                    </span>
                    <span className="shrink-0 text-sm text-stone">
                      {c.productCount} {c.productCount === 1 ? "piece" : "pieces"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-2 lg:px-10">
        <div>
          <h2 className="font-display text-3xl sm:text-4xl">How to order</h2>
        </div>
        <div className="space-y-4 text-ink">
          <p>
            Found something you love? Choose your size and colour, then tap <strong className="font-medium">Enquire on WhatsApp</strong>. We&rsquo;ll confirm availability, delivery and payment with you directly.
          </p>
          <p className="text-stone">
            {delivery.summary}{" "}
            <Link href="/delivery" className="link-underline text-charcoal">
              Delivery details
            </Link>
          </p>
        </div>
      </section>
    </>
  );
}
