import { describe, expect, it } from "vitest";
import { productJsonLd, serializeJsonLd } from "@/lib/structured-data";
import type { PublicProduct } from "@/server/catalogue/repository";

const product: PublicProduct = {
  id: "p1",
  slug: "polka-dot",
  name: "Polka Dot Dress",
  description: "A dress.",
  details: null,
  updatedAt: new Date(),
  category: { name: "Dresses", slug: "dresses" },
  priceFromMinor: 380000,
  priceToMinor: 420000,
  inStock: true,
  images: [{ url: "/placeholders/a.webp", alt: "a", width: 1200, height: 1500 }, { url: "https://cdn.example/b.webp", alt: "b", width: 800, height: 800 }],
  variants: [
    { id: "v1", sku: "SKU-M", size: "M", colour: "White", colourHex: null, priceMinor: 380000, available: true, lowStock: false },
    { id: "v2", sku: "SKU-L", size: "L", colour: "White", colourHex: null, priceMinor: 420000, available: false, lowStock: false },
  ],
};

describe("product structured data", () => {
  const data = productJsonLd(product, { siteUrl: "https://merven.example", sellerName: "Merven Fashions" });

  it("uses stored prices and real availability per variant", () => {
    expect(data.offers).toEqual([
      expect.objectContaining({ sku: "SKU-M", price: "3800.00", priceCurrency: "KES", availability: "https://schema.org/InStock" }),
      expect.objectContaining({ sku: "SKU-L", price: "4200.00", availability: "https://schema.org/OutOfStock" }),
    ]);
  });

  it("names the boutique as seller and claims no brand", () => {
    expect(data).not.toHaveProperty("brand");
    expect(data.offers[0].seller).toEqual({ "@type": "Organization", name: "Merven Fashions" });
  });

  it("uses absolute canonical URLs", () => {
    expect(data.url).toBe("https://merven.example/products/polka-dot");
    expect(data.image).toEqual(["https://merven.example/placeholders/a.webp", "https://cdn.example/b.webp"]);
  });

  it("has no offers when nothing is purchasable", () => {
    expect(productJsonLd({ ...product, variants: [] }, { siteUrl: "x", sellerName: "y" }).offers).toEqual([]);
  });

  it("cannot break out of the script tag", () => {
    const json = serializeJsonLd(productJsonLd({ ...product, name: "</script><script>alert(1)</script>" }, { siteUrl: "x", sellerName: "y" }));
    expect(json).not.toContain("</script>");
    expect(JSON.parse(json).name).toBe("</script><script>alert(1)</script>");
  });
});
