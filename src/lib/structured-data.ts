import type { PublicProduct } from "@/server/catalogue/repository";

/**
 * schema.org Product data built only from stored catalogue values: one Offer
 * per active variant with its stored price and real availability. The boutique
 * is the seller, not the garment's brand (most pieces are not Merven-made), so
 * no `brand` is claimed.
 */
export function productJsonLd(product: PublicProduct, opts: { siteUrl: string; sellerName: string }) {
  const absolute = (url: string) => (url.startsWith("http") ? url : `${opts.siteUrl}${url}`);
  const url = absolute(`/products/${product.slug}`);
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description,
    image: product.images.map((i) => absolute(i.url)),
    category: product.category.name,
    url,
    offers: product.variants.map((v) => ({
      "@type": "Offer",
      sku: v.sku,
      name: `${product.name} — ${v.colour}, ${v.size}`,
      price: (v.priceMinor / 100).toFixed(2),
      priceCurrency: "KES",
      availability: v.available ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url,
      areaServed: { "@type": "Country", name: "Kenya" },
      seller: { "@type": "Organization", name: opts.sellerName },
    })),
  };
}

/** Serialises JSON-LD for a <script> tag; "<" is escaped so text can't close the element. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
