import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ProductGallery } from "@/components/catalogue/product-gallery";
import { VariantPicker } from "@/components/catalogue/variant-picker";
import { delivery, site } from "@/content/site";
import { serverEnv, siteUrl } from "@/env";
import { getProduct, getPublishedSlugs } from "@/server/catalogue/queries";
import type { PublicProduct } from "@/server/catalogue/repository";

// Prebuild every published product at deploy time so first visits are instant.
// Cache Components requires at least one entry; the placeholder renders notFound().
export async function generateStaticParams() {
  const products = await getPublishedSlugs();
  return products.length ? products.map((p) => ({ slug: p.slug })) : [{ slug: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();
  const description = product.description.slice(0, 155);
  const image = product.images[0];
  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      url: `/products/${product.slug}`,
      images: image ? [{ url: image.url, width: image.width, height: image.height, alt: image.alt }] : undefined,
    },
  };
}

function absolute(url: string) {
  return url.startsWith("http") ? url : `${siteUrl()}${url}`;
}

function ProductJsonLd({ product }: { product: PublicProduct }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images.map((i) => absolute(i.url)),
    category: product.category.name,
    brand: { "@type": "Brand", name: site.name },
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      name: `${product.name} — ${v.colour}, ${v.size}`,
      price: (v.priceMinor / 100).toFixed(2),
      priceCurrency: "KES",
      availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url: absolute(`/products/${product.slug}`),
      areaServed: { "@type": "Country", name: "Kenya" },
    })),
  };
  // Escape "<" so product text can never close the script element.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}

async function ProductContent({ params }: { params: PageProps<"/products/[slug]">["params"] }) {
  const { slug } = await params;
  const product = await getProduct(slug);
  if (!product) notFound();

  return (
    <article className="grid gap-10 lg:grid-cols-12 lg:gap-14">
      <ProductJsonLd product={product} />
      <div className="lg:col-span-7">
        <ProductGallery images={product.images} name={product.name} />
      </div>
      <div className="lg:col-span-5 lg:pt-4">
        <nav aria-label="Breadcrumb" className="label text-stone">
          <Link href="/shop" className="hover:text-charcoal">Shop</Link>
          <span aria-hidden> / </span>
          <Link href={`/shop/${product.category.slug}`} className="hover:text-charcoal">{product.category.name}</Link>
        </nav>
        <h1 className="mt-4 font-display text-4xl leading-tight sm:text-5xl">{product.name}</h1>
        <div className="mt-6">
          {product.variants.length > 0 ? (
            <VariantPicker
              productName={product.name}
              productUrl={absolute(`/products/${product.slug}`)}
              priceFromMinor={product.priceFromMinor}
              priceToMinor={product.priceToMinor}
              variants={product.variants}
              whatsappNumber={serverEnv().WHATSAPP_NUMBER}
            />
          ) : (
            <p className="text-stone">Currently unavailable.</p>
          )}
        </div>
        <div className="mt-12 space-y-8 border-t border-line pt-8">
          <section>
            <h2 className="label mb-3 text-stone">Description</h2>
            <div className="prose-editorial leading-relaxed text-ink">
              {product.description.split(/\n{2,}/).map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
          {product.details && (
            <section>
              <h2 className="label mb-3 text-stone">Fabric &amp; care</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-ink">{product.details}</p>
            </section>
          )}
          <section>
            <h2 className="label mb-3 text-stone">Delivery</h2>
            <p className="text-sm text-ink">
              {delivery.summary}{" "}
              <Link href="/delivery" className="link-underline">
                See delivery times
              </Link>
            </p>
          </section>
        </div>
      </div>
    </article>
  );
}

export default function ProductPage({ params }: PageProps<"/products/[slug]">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-10 lg:py-14">
      <Suspense
        fallback={
          <div className="grid gap-10 lg:grid-cols-12">
            <div className="aspect-[4/5] bg-ivory-deep lg:col-span-7" />
            <div className="space-y-4 lg:col-span-5">
              <div className="h-3 w-24 bg-ivory-deep" />
              <div className="h-12 w-3/4 bg-ivory-deep" />
            </div>
          </div>
        }
      >
        <ProductContent params={params} />
      </Suspense>
    </div>
  );
}
