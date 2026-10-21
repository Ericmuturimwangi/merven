import { describe, expect, it } from "vitest";
import { createSupabaseImageStorage, isSupabaseKey } from "@/server/images/supabase-driver";

// Exercises the real Supabase SDK against a fake fetch, so request shape
// (URL, headers, method) is checked without network access or credentials.

const URL_ = "https://abcdefghijklmnop.supabase.co";
const SECRET = "sb_secret_test_0123456789abcdef";
const image = { data: Buffer.from("RIFF0000WEBPVP8 fake"), width: 800, height: 1000, contentType: "image/webp" as const };

type Call = { url: string; method: string; headers: Headers; body: unknown };

function fakeFetch(respond: (c: Call) => Response = () => Response.json({ Key: "k", Id: "1" })) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = {
      url: String(input instanceof Request ? input.url : input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fn, calls };
}

describe("Supabase image storage driver", () => {
  it("uploads to products/<productId>/<uuid>.webp in the bucket without overwriting", async () => {
    const { fn, calls } = fakeFetch();
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, fetch: fn });
    const stored = await storage.put(image, { productId: "clx123abc" });

    expect(stored.key).toMatch(/^products\/clx123abc\/[0-9a-f-]{36}\.webp$/);
    expect(stored.url).toBe(`${URL_}/storage/v1/object/public/product-images/${stored.key}`);
    expect(calls).toHaveLength(1);
    const [c] = calls;
    expect(c.method).toBe("POST");
    expect(c.url).toBe(`${URL_}/storage/v1/object/product-images/${stored.key}`);
    expect(c.headers.get("apikey")).toBe(SECRET);
    expect(c.headers.get("x-upsert")).toBe("false");
  });

  it("uses a custom bucket when configured", async () => {
    const { fn, calls } = fakeFetch();
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, bucket: "merven-staging", fetch: fn });
    const stored = await storage.put(image, { productId: "p1" });
    expect(calls[0].url).toContain("/storage/v1/object/merven-staging/products/p1/");
    expect(stored.url).toContain("/object/public/merven-staging/");
  });

  it("refuses unsafe product ids before any request", async () => {
    const { fn, calls } = fakeFetch();
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, fetch: fn });
    for (const bad of ["../etc", "a/b", "", "UPPER", "x".repeat(65), "id%2F.."]) {
      await expect(storage.put(image, { productId: bad })).rejects.toThrow();
    }
    expect(calls).toHaveLength(0);
  });

  it("refuses anything that isn't a re-encoded WebP", async () => {
    const { fn, calls } = fakeFetch();
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, fetch: fn });
    await expect(storage.put({ ...image, contentType: "image/png" as never }, { productId: "p1" })).rejects.toThrow(/WebP/);
    expect(calls).toHaveLength(0);
  });

  it("surfaces upload errors", async () => {
    const { fn } = fakeFetch(() => Response.json({ statusCode: "403", error: "Unauthorized", message: "new row violates row-level security policy" }, { status: 403 }));
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, fetch: fn });
    await expect(storage.put(image, { productId: "p1" })).rejects.toThrow(/Supabase upload failed/);
  });

  it("deletes only keys this app created", async () => {
    const { fn, calls } = fakeFetch(() => Response.json([]));
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, fetch: fn });
    const key = "products/p1/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp";
    await storage.remove(key);
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe(`${URL_}/storage/v1/object/product-images`);
    expect(JSON.parse(String(calls[0].body))).toEqual({ prefixes: [key] });

    for (const other of ["placeholder:amani-1", "products/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp", "products/p1/../../secret.webp", "products/p1/", "", "products/p1/*.webp"]) {
      await storage.remove(other);
    }
    expect(calls).toHaveLength(1);
  });

  it("surfaces delete errors", async () => {
    const { fn } = fakeFetch(() => Response.json({ statusCode: "500", error: "x", message: "boom" }, { status: 500 }));
    const storage = createSupabaseImageStorage({ url: URL_, secretKey: SECRET, fetch: fn });
    await expect(storage.remove("products/p1/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp")).rejects.toThrow(/delete failed/);
  });

  it("validates keys strictly", () => {
    expect(isSupabaseKey("products/abc123/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp")).toBe(true);
    expect(isSupabaseKey("products/abc123/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.png")).toBe(false);
    expect(isSupabaseKey("other/abc123/0f8b6f8e-1d2c-4b3a-9e8f-7a6b5c4d3e2f.webp")).toBe(false);
  });
});
