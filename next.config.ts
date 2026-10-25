import type { NextConfig } from "next";
import { catalogueRedirects, toNextRedirects } from "./src/content/redirects";
import { securityHeaders as securityHeadersFor } from "./src/lib/security-headers";

const securityHeaders = securityHeadersFor({ isDev: process.env.NODE_ENV === "development" });

// Only public objects in this project's product-images bucket may pass through the optimiser.
function supabaseImagePattern() {
  if (!process.env.SUPABASE_URL) return [];
  const { protocol, hostname, port } = new URL(process.env.SUPABASE_URL);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || "product-images";
  return [
    {
      protocol: protocol.replace(":", "") as "http" | "https",
      hostname,
      port,
      pathname: `/storage/v1/object/public/${bucket}/products/**`,
      search: "",
    },
  ];
}

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  images: {
    qualities: [75, 85],
    formats: ["image/avif", "image/webp"],
    localPatterns: [
      { pathname: "/placeholders/**", search: "" },
      { pathname: "/media/**", search: "" },
    ],
    remotePatterns: supabaseImagePattern(),
  },
  experimental: {
    serverActions: {
      // Admin image uploads are capped at 5 MB; leave room for multipart overhead.
      bodySizeLimit: "6mb",
    },
  },
  async redirects() {
    return toNextRedirects(catalogueRedirects);
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
