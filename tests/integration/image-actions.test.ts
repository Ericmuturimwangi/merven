import sharp from "sharp";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDb, makeCategory, resetDb, testPrisma } from "../support/db";

// Runs the real upload/delete server actions against the test database with an
// authenticated admin and an in-memory storage backend whose failures we control.

const prisma = testPrisma();

const h = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(),
  failPut: false,
  failRemove: false,
  onPut: null as null | (() => Promise<void>),
  putCalls: 0,
}));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({ updateTag: () => {}, refresh: () => {}, cacheTag: () => {}, cacheLife: () => {} }));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "admin-1" } }) } } }));
vi.mock("@/server/db", async () => {
  const { testPrisma } = await import("../support/db");
  return { db: testPrisma() };
});
vi.mock("@/server/images/storage", () => ({
  imageStorage: () => ({
    async put(image: { data: Buffer }, { productId }: { productId: string }) {
      h.putCalls++;
      if (h.failPut) throw new Error("storage unavailable");
      const key = `products/${productId}/${crypto.randomUUID()}.webp`;
      h.objects.set(key, image.data);
      await h.onPut?.();
      return { key, url: `https://example.supabase.co/storage/v1/object/public/product-images/${key}` };
    },
    async remove(key: string) {
      if (h.failRemove) throw new Error("storage unavailable");
      h.objects.delete(key);
    },
  }),
}));

const actions = await import("@/server/admin/actions");
const service = await import("@/server/admin/catalogue-service");

async function jpeg(w = 900, h_ = 1125) {
  return sharp({ create: { width: w, height: h_, channels: 3, background: "#6e2b2b" } }).jpeg().toBuffer();
}

function uploadForm(productId: string, file: Blob, alt = "Front view of the dress") {
  const f = new FormData();
  f.set("productId", productId);
  f.set("alt", alt);
  f.set("file", file);
  return f;
}

const imagesOf = (productId: string) =>
  prisma.productImage.findMany({ where: { productId }, orderBy: { sortOrder: "asc" } });

describe.skipIf(!hasTestDb)("image upload and delete actions", () => {
  let productId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    h.objects.clear();
    h.failPut = h.failRemove = false;
    h.onPut = null;
    h.putCalls = 0;
    await prisma.adminUser.create({ data: { id: "admin-1", name: "Admin", email: "admin@test.local", isActive: true } });
    const category = await makeCategory(prisma);
    productId = (
      await prisma.product.create({
        data: { slug: "test-dress", name: "Test Dress", description: "A test dress.", priceMinor: 500000, categoryId: category.id },
      })
    ).id;
  });
  afterAll(() => prisma.$disconnect());

  it("stores a valid image and records its key, URL, dimensions and alt text", async () => {
    const res = await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())], { type: "image/jpeg" })));
    expect(res).toMatchObject({ ok: true, message: "Image uploaded." });

    const [img] = await imagesOf(productId);
    expect(img).toMatchObject({ alt: "Front view of the dress", width: 900, height: 1125, sortOrder: 0 });
    expect(img.storageKey).toMatch(new RegExp(`^products/${productId}/[0-9a-f-]{36}\\.webp$`));
    expect(img.url).toBe(`https://example.supabase.co/storage/v1/object/public/product-images/${img.storageKey}`);
    const stored = h.objects.get(img.storageKey)!;
    expect((await sharp(stored).metadata()).format).toBe("webp");
  });

  it.each([
    ["a text file labelled as JPEG", () => new Blob(["not an image"], { type: "image/jpeg" })],
    ["an SVG", () => new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>'], { type: "image/svg+xml" })],
    ["an oversized file", () => new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/jpeg" })],
    ["an empty file", () => new Blob([], { type: "image/jpeg" })],
  ])("rejects %s without touching storage or the database", async (_label, make) => {
    const res = await actions.uploadImageAction({ ok: false }, uploadForm(productId, make()));
    expect(res.ok).toBe(false);
    expect(h.putCalls).toBe(0);
    expect(await imagesOf(productId)).toHaveLength(0);
  });

  it("rejects a truncated (malformed) JPEG", async () => {
    const res = await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array((await jpeg()).subarray(0, 200))])));
    expect(res.ok).toBe(false);
    expect(h.putCalls).toBe(0);
  });

  it("rejects malformed form submissions", async () => {
    const noFile = new FormData();
    noFile.set("productId", productId);
    noFile.set("alt", "Front view");
    expect((await actions.uploadImageAction({ ok: false }, noFile)).ok).toBe(false);
    expect((await actions.uploadImageAction({ ok: false }, uploadForm("../../etc", new Blob([new Uint8Array(await jpeg())])))).ok).toBe(false);
    expect((await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())]), ""))).ok).toBe(false);
    expect((await actions.uploadImageAction({ ok: false }, uploadForm("doesnotexist", new Blob([new Uint8Array(await jpeg())])))).ok).toBe(false);
    expect(h.putCalls).toBe(0);
  });

  it("creates no database row when storage fails", async () => {
    h.failPut = true;
    const res = await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())])));
    expect(res.ok).toBe(false);
    expect(await imagesOf(productId)).toHaveLength(0);
  });

  it("removes the stored file when the database insert fails", async () => {
    // Product disappears between validation and insert (e.g. a concurrent change).
    h.onPut = async () => {
      await prisma.product.delete({ where: { id: productId } });
    };
    const res = await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())])));
    expect(res.ok).toBe(false);
    expect(h.putCalls).toBe(1);
    expect(h.objects.size).toBe(0);
  });

  it("orders, reorders and deletes images, removing the stored file", async () => {
    for (const alt of ["First image", "Second image", "Third image"]) {
      expect((await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())]), alt))).ok).toBe(true);
    }
    let images = await imagesOf(productId);
    expect(images.map((i) => i.alt)).toEqual(["First image", "Second image", "Third image"]);

    const move = new FormData();
    move.set("imageId", images[2].id);
    move.set("direction", "up");
    await actions.moveImageAction({ ok: false }, move);
    images = await imagesOf(productId);
    expect(images.map((i) => i.alt)).toEqual(["First image", "Third image", "Second image"]);

    const del = new FormData();
    del.set("imageId", images[0].id);
    expect(await actions.deleteImageAction({ ok: false }, del)).toMatchObject({ ok: true });
    expect((await imagesOf(productId)).map((i) => i.alt)).toEqual(["Third image", "Second image"]);
    expect(h.objects.has(images[0].storageKey)).toBe(false);
    expect(h.objects.size).toBe(2);
  });

  it("still deletes the record if removing the file fails (orphan file is logged, never a broken image)", async () => {
    await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())])));
    const [img] = await imagesOf(productId);
    h.failRemove = true;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const del = new FormData();
    del.set("imageId", img.id);
    expect(await actions.deleteImageAction({ ok: false }, del)).toMatchObject({ ok: true });
    expect(await imagesOf(productId)).toHaveLength(0);
    expect(errors).toHaveBeenCalledWith("[image cleanup]", expect.any(Error));
    errors.mockRestore();
  });

  it("keeps publishing and archiving behaviour unchanged with stored images", async () => {
    await actions.uploadImageAction({ ok: false }, uploadForm(productId, new Blob([new Uint8Array(await jpeg())])));
    await service.addVariant(prisma, productId, { size: "M", colour: "Wine", colourHex: null, sku: null, price: null, stock: 2, active: true });
    await service.setProductStatus(prisma, productId, "PUBLISHED");

    const { getProductBySlug } = await import("@/server/catalogue/repository");
    const pub = await getProductBySlug(prisma, "test-dress");
    expect(pub?.images[0].url).toMatch(/^https:\/\/example\.supabase\.co\/storage\/v1\/object\/public\/product-images\/products\//);

    const [img] = await imagesOf(productId);
    const del = new FormData();
    del.set("imageId", img.id);
    expect(await actions.deleteImageAction({ ok: false }, del)).toMatchObject({ ok: false, message: expect.stringMatching(/at least one image/) });
    expect(h.objects.size).toBe(1);

    await service.setProductStatus(prisma, productId, "ARCHIVED");
    expect(await getProductBySlug(prisma, "test-dress")).toBeNull();
  });
});
