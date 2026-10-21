import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  // Nonce-free CSP subset: blocks framing, plugin content and form posts to other origins.
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
];

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
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
    ];
  },
};

export default nextConfig;
