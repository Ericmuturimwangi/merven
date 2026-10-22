import Image from "next/image";
import Link from "next/link";
import { ProductGrid } from "@/components/catalogue/product-card";
import { ordering, site } from "@/content/site";
import { imageFit } from "@/lib/image-fit";
import { getCategories, getFeaturedProducts } from "@/server/catalogue/queries";
import type { PublicImage, PublicProductCard } from "@/server/catalogue/repository";

function fit(img: PublicImage) {
  return imageFit(img.width, img.height) === "cover" ? "object-cover" : "object-contain";
}

/** Hero photos come from featured products, preferring ones that suit a portrait frame. */
function heroImages(featured: PublicProductCard[]) {
  const withImages = featured.filter((p) => p.image);
  const portrait = withImages.filter((p) => imageFit(p.image!.width, p.image!.height) === "cover");
  const ordered = [...portrait, ...withImages.filter((p) => !portrait.includes(p))];
  return ordered.slice(0, 2);
}

export default async function HomePage() {
  const [featured, categories] = await Promise.all([getFeaturedProducts(8), getCategories()]);
  const [lead, second] = heroImages(featured);

  return (
    <>
      <section className="mx-auto grid max-w-7xl gap-8 px-4 pb-16 pt-6 sm:px-6 md:grid-cols-12 md:items-center md:gap-10 md:pt-12 lg:px-10 lg:pb-24">
        <div className="order-2 md:order-1 md:col-span-5">
          <h1 className="font-display text-[2.75rem] font-medium leading-[1.02] sm:text-6xl lg:text-7xl">{site.tagline}</h1>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-ink">{site.intro}</p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link
              href="/shop"
              className="inline-flex min-h-12 items-center bg-forest px-7 text-sm tracking-wide text-white transition-colors hover:bg-forest-deep"
            >
              Explore the collection
            </Link>
            <Link href="/delivery" className="link-underline text-sm text-ink hover:text-forest">
              How ordering works
            </Link>
          </div>
        </div>
        {lead?.image && (
          <div className="order-1 grid grid-cols-6 gap-3 md:order-2 md:col-span-7 md:gap-4">
            <Link
              href={`/products/${lead.slug}`}
              className={`relative aspect-[4/5] bg-white ${second?.image ? "col-span-6 sm:col-span-4" : "col-span-6"}`}
            >
              <Image src={lead.image.url} alt={lead.image.alt} fill priority sizes="(min-width: 768px) 40vw, 100vw" className={fit(lead.image)} />
            </Link>
            {second?.image && (
              <Link href={`/products/${second.slug}`} className="relative hidden aspect-[3/4] self-end bg-white sm:col-span-2 sm:block">
                <Image src={second.image.url} alt={second.image.alt} fill sizes="20vw" className={fit(second.image)} />
              </Link>
            )}
          </div>
        )}
      </section>

      {featured.length > 0 && (
        <section aria-labelledby="edit-heading" className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10">
          <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
            <h2 id="edit-heading" className="font-display text-3xl font-medium sm:text-4xl">
              The Edit
            </h2>
            <Link href="/shop" className="link-underline text-sm hover:text-forest">
              Shop all
            </Link>
          </div>
          <ProductGrid products={featured} />
        </section>
      )}

      {categories.length > 0 && (
        <section aria-labelledby="categories-heading" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-10">
          <h2 id="categories-heading" className="mb-8 font-display text-3xl font-medium sm:text-4xl">
            Shop by category
          </h2>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-5">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/shop/${c.slug}`} className="group block">
                  <div className="relative aspect-[3/4] overflow-hidden bg-white">
                    {c.cover ? (
                      <Image src={c.cover.url} alt="" fill sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw" className={fit(c.cover)} />
                    ) : (
                      <div className="absolute inset-0 bg-ivory-deep" />
                    )}
                  </div>
                  <p className="mt-3 flex flex-col sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                    <span className="font-display text-xl leading-tight group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
                      {c.name}
                    </span>
                    <span className="mt-0.5 text-xs text-stone sm:mt-0">
                      {c.productCount} {c.productCount === 1 ? "piece" : "pieces"}
                    </span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="about-heading" className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-6 px-4 py-16 sm:px-6 md:grid-cols-12 lg:px-10 lg:py-20">
          <div className="md:col-span-4">
            <span aria-hidden className="mb-5 block h-px w-12 bg-champagne" />
            <h2 id="about-heading" className="font-display text-3xl font-medium sm:text-4xl">
              About Merven
            </h2>
          </div>
          <div className="space-y-4 text-base leading-relaxed text-ink md:col-span-7 md:col-start-6">
            {site.about.map((p) => (
              <p key={p}>{p}</p>
            ))}
          </div>
        </div>
      </section>

      <section aria-labelledby="order-heading" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-10">
        <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
          <h2 id="order-heading" className="font-display text-3xl font-medium sm:text-4xl">
            How ordering works
          </h2>
          <Link href="/delivery" className="link-underline text-sm hover:text-forest">
            Delivery &amp; ordering
          </Link>
        </div>
        <ol className="grid gap-8 md:grid-cols-3 md:gap-10">
          {ordering.steps.map((s, i) => (
            <li key={s.title} className="border-t border-line pt-5">
              <span aria-hidden className="font-display text-3xl text-champagne">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-2 text-base font-medium">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-ink">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
