import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as repo from "@/server/catalogue/repository";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

describe.skipIf(!hasTestDb)("public catalogue visibility", () => {
  const prisma = testPrisma();
  let dresses: { id: string; slug: string };
  let emptyCategory: { id: string; slug: string };

  beforeAll(async () => {
    await resetDb(prisma);
    dresses = await makeCategory(prisma, "Dresses");
    emptyCategory = await makeCategory(prisma, "Only drafts");
    await makeProduct(prisma, { categoryId: dresses.id, slug: "live-dress", name: "Live emerald dress", featured: true });
    await makeProduct(prisma, { categoryId: dresses.id, slug: "draft-dress", name: "Draft emerald dress", status: "DRAFT", featured: true });
    await makeProduct(prisma, { categoryId: dresses.id, slug: "archived-dress", name: "Archived emerald dress", status: "ARCHIVED", featured: true });
    await makeProduct(prisma, { categoryId: emptyCategory.id, slug: "secret-draft", status: "DRAFT" });
  });
  afterAll(() => prisma.$disconnect());

  it("lists only published products", async () => {
    const { items, total } = await repo.listProducts(prisma);
    expect(items.map((p) => p.slug)).toEqual(["live-dress"]);
    expect(total).toBe(1);
  });

  it("does not resolve draft or archived products by slug", async () => {
    expect(await repo.getProductBySlug(prisma, "live-dress")).not.toBeNull();
    expect(await repo.getProductBySlug(prisma, "draft-dress")).toBeNull();
    expect(await repo.getProductBySlug(prisma, "archived-dress")).toBeNull();
  });

  it("excludes unpublished products from featured, search, category listings and the sitemap", async () => {
    expect((await repo.listFeaturedProducts(prisma)).map((p) => p.slug)).toEqual(["live-dress"]);
    expect((await repo.listProducts(prisma, { query: "emerald" })).items.map((p) => p.slug)).toEqual(["live-dress"]);
    expect((await repo.listProducts(prisma, { categorySlug: dresses.slug })).total).toBe(1);
    expect((await repo.listProducts(prisma, { categorySlug: emptyCategory.slug })).total).toBe(0);
    expect((await repo.listPublishedSlugs(prisma)).map((p) => p.slug)).toEqual(["live-dress"]);
  });

  it("hides categories that have no published products and counts only published ones", async () => {
    const cats = await repo.listCategories(prisma);
    expect(cats).toHaveLength(1);
    expect(cats[0]).toMatchObject({ slug: dresses.slug, productCount: 1 });
    // The cover photo comes from the published product, never a featured draft.
    expect(cats[0].cover?.url).toBe("/placeholders/live-dress-0.webp");
  });

  it("reflects status changes immediately", async () => {
    await prisma.product.update({ where: { slug: "draft-dress" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    expect(await repo.getProductBySlug(prisma, "draft-dress")).not.toBeNull();
    await prisma.product.update({ where: { slug: "live-dress" }, data: { status: "ARCHIVED" } });
    expect(await repo.getProductBySlug(prisma, "live-dress")).toBeNull();
  });
});
