import type { MetadataRoute } from "next";
import { siteUrl } from "@/env";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/search"] }],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
