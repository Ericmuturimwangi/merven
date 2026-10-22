import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

// Every successful admin mutation must expire the public catalogue cache (so
// prices, stock and visibility update immediately); failed ones must not.

const prisma = testPrisma();
const calls = vi.hoisted(() => ({ tags: [] as string[], refreshes: 0 }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("next/cache", () => ({
  updateTag: (t: string) => calls.tags.push(t),
  refresh: () => calls.refreshes++,
  cacheTag: () => {},
  cacheLife: () => {},
}));
vi.mock("@/server/auth/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "admin-1" } }) } } }));
vi.mock("@/server/db", async () => {
  const { testPrisma } = await import("../support/db");
  return { db: testPrisma() };
});

const actions = await import("@/server/admin/actions");
const { CATALOGUE_TAG } = await import("@/server/catalogue/queries");

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe.skipIf(!hasTestDb)("catalogue cache invalidation", () => {
  let categoryId: string;
  let categorySlug: string;
  let productId: string;
  let variantId: string;

  beforeEach(async () => {
    await resetDb(prisma);
    calls.tags = [];
    calls.refreshes = 0;
    await prisma.adminUser.create({ data: { id: "admin-1", name: "Admin", email: "admin@test.local", isActive: true } });
    ({ id: categoryId, slug: categorySlug } = await makeCategory(prisma, "Dresses"));
    const p = await makeProduct(prisma, { categoryId, slug: "cached-dress", variants: [{ size: "M", colour: "Black", stock: 3 }] });
    productId = p.id;
    variantId = (await prisma.productVariant.findFirstOrThrow({ where: { productId } })).id;
  });
  afterAll(() => prisma.$disconnect());

  const product = (overrides: Record<string, string> = {}) => ({
    id: productId,
    name: "Cached Dress",
    description: "A dress used for cache tests.",
    categoryId,
    price: "5000",
    ...overrides,
  });

  const successes: [string, () => Promise<unknown>][] = [
    ["update product (price)", () => actions.updateProductAction({ ok: false }, form(product({ price: "4500" })))],
    ["set stock", () => actions.setVariantStockAction({ ok: false }, form({ variantId, stock: "0" }))],
    ["update variant", () => actions.updateVariantAction({ ok: false }, form({ variantId, size: "M", colour: "Black", stock: "2", active: "false" }))],
    ["add variant", () => actions.addVariantAction({ ok: false }, form({ productId, size: "L", colour: "Black", stock: "1", active: "true" }))],
    ["unpublish", () => actions.setProductStatusAction({ ok: false }, form({ id: productId, status: "DRAFT" }))],
    ["archive", () => actions.setProductStatusAction({ ok: false }, form({ id: productId, status: "ARCHIVED" }))],
    ["feature", () => actions.setProductFeaturedAction({ ok: false }, form({ id: productId, featured: "true" }))],
    ["create category", () => actions.createCategoryAction({ ok: false }, form({ name: "Knitwear", sortOrder: "1" }))],
    ["update category", () => actions.updateCategoryAction({ ok: false }, form({ id: categoryId, name: "The Dress Edit", slug: categorySlug, sortOrder: "0" }))],
  ];

  it.each(successes)("%s expires the catalogue cache", async (_label, run) => {
    expect(await run()).toMatchObject({ ok: true });
    expect(calls.tags).toEqual([CATALOGUE_TAG]);
    expect(calls.refreshes).toBe(1);
  });

  it("creating a product expires the cache before redirecting to it", async () => {
    await expect(actions.createProductAction({ ok: false }, form({ ...product(), id: "" }))).rejects.toMatchObject({ url: expect.stringMatching(/^\/admin\/products\//) });
    expect(calls.tags).toEqual([CATALOGUE_TAG]);
  });

  it.each([
    ["invalid stock", () => actions.setVariantStockAction({ ok: false }, form({ variantId, stock: "-1" }))],
    ["invalid price", () => actions.updateProductAction({ ok: false }, form(product({ price: "free" })))],
    ["unknown product", () => actions.setProductStatusAction({ ok: false }, form({ id: "doesnotexist", status: "ARCHIVED" }))],
  ])("%s changes nothing and leaves the cache alone", async (_label, run) => {
    expect(await run()).toMatchObject({ ok: false });
    expect(calls.tags).toEqual([]);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stock).toBe(3);
  });
});
