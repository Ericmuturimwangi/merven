import { afterEach, describe, expect, it, vi } from "vitest";

const base = {
  // Blank out anything the developer's real .env might provide.
  IMAGE_STORAGE: "",
  SUPABASE_URL: "",
  SUPABASE_SECRET_KEY: "",
  SUPABASE_STORAGE_BUCKET: "",
  VERCEL: "",
  DATABASE_URL: "postgresql://x@localhost/db",
  BETTER_AUTH_SECRET: "x".repeat(32),
  BETTER_AUTH_URL: "https://merven.example",
  NEXT_PUBLIC_SITE_URL: "https://merven.example",
  WHATSAPP_NUMBER: "254712345678",
};

async function load(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries({ ...base, ...env })) vi.stubEnv(k, v);
  const { serverEnv } = await import("@/env");
  return serverEnv;
}

afterEach(() => vi.unstubAllEnvs());

describe("storage environment validation", () => {
  it("accepts a Supabase configuration with a secret key and defaults the bucket", async () => {
    const env = (await load({ IMAGE_STORAGE: "supabase", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_abc" }))();
    expect(env.SUPABASE_STORAGE_BUCKET).toBe("product-images");
  });

  it("requires URL and secret key for Supabase", async () => {
    expect(await load({ IMAGE_STORAGE: "supabase" })).toThrow(/SUPABASE_URL is required/);
    expect(await load({ IMAGE_STORAGE: "supabase", SUPABASE_URL: "https://abc.supabase.co" })).toThrow(/SUPABASE_SECRET_KEY is required/);
  });

  it.each([
    ["a publishable key", "sb_publishable_abc"],
    ["a legacy JWT key", "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig"],
  ])("rejects %s", async (_l, key) => {
    expect(await load({ IMAGE_STORAGE: "supabase", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: key })).toThrow(/sb_secret_/);
  });

  it("treats blank optional variables as unset", async () => {
    const env = (await load({ IMAGE_STORAGE: "local", SUPABASE_URL: "", SUPABASE_SECRET_KEY: "", SUPABASE_STORAGE_BUCKET: "" }))();
    expect(env.SUPABASE_URL).toBeUndefined();
    expect(env.SUPABASE_STORAGE_BUCKET).toBe("product-images");
  });

  it("refuses local disk storage on Vercel", async () => {
    expect(await load({ IMAGE_STORAGE: "local", VERCEL: "1" })).toThrow(/not allowed on Vercel/);
  });

  it("rejects unsafe bucket names", async () => {
    expect(
      await load({ IMAGE_STORAGE: "supabase", SUPABASE_URL: "https://abc.supabase.co", SUPABASE_SECRET_KEY: "sb_secret_x", SUPABASE_STORAGE_BUCKET: "../x" }),
    ).toThrow(/bucket/i);
  });
});
