import type { MetadataRoute } from "next";
import { siteUrl } from "@/env";
import { getCategories, getPublishedSlugs } from "@/server/catalogue/queries";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const [products, categories] = await Promise.all([getPublishedSlugs(), getCategories()]);
  return [
    { url: `${base}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/shop`, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/delivery`, changeFrequency: "monthly", priority: 0.3 },
    ...categories.map((c) => ({ url: `${base}/shop/${c.slug}`, changeFrequency: "weekly" as const, priority: 0.7 })),
    ...products.map((p) => ({ url: `${base}/products/${p.slug}`, lastModified: p.updatedAt, priority: 0.8 })),
  ];
}
