import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as repo from "@/server/catalogue/repository";
import { hasTestDb, makeCategory, resetDb, testPrisma } from "../support/db";

describe.skipIf(!hasTestDb)("deterministic catalogue ordering", () => {
  const prisma = testPrisma();
  let productId: string;

  beforeAll(async () => {
    await resetDb(prisma);
    const category = await makeCategory(prisma, "Dresses");
    const published = new Date("2026-10-01T10:00:00Z");
    // 7 products with identical price and publish time: only the tiebreaker orders them.
    for (let i = 0; i < 7; i++) {
      await prisma.product.create({
        data: {
          slug: `same-${i}`,
          name: "Same Name",
          description: "Identical sort keys.",
          priceMinor: 500000,
          status: "PUBLISHED",
          publishedAt: published,
          createdAt: published,
          categoryId: category.id,
          variants: { create: { sku: `SAME-${i}`, size: "M", colour: "Black", stock: 1 } },
        },
      });
    }
    // Three images, two sharing position 2, uploaded in a known order.
    const p = await prisma.product.findUniqueOrThrow({ where: { slug: "same-0" } });
    productId = p.id;
    const img = (key: string, sortOrder: number, at: string) =>
      prisma.productImage.create({
        data: { productId, storageKey: key, url: `/placeholders/${key}.webp`, alt: key, width: 800, height: 1000, sortOrder, createdAt: new Date(at) },
      });
    await img("third", 2, "2026-10-03T00:00:00Z");
    await img("second", 2, "2026-10-02T00:00:00Z");
    await img("first", 1, "2026-10-04T00:00:00Z");
  });
  afterAll(() => prisma.$disconnect());

  it("orders tied image positions by upload time, matching the admin", async () => {
    const product = (await repo.getProductBySlug(prisma, "same-0"))!;
    expect(product.images.map((i) => i.alt)).toEqual(["first", "second", "third"]);
    const admin = await prisma.productImage.findMany({ where: { productId }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
    expect(admin.map((i) => i.alt)).toEqual(product.images.map((i) => i.alt));
  });

  it("returns the same order on every call", async () => {
    const runs = await Promise.all(Array.from({ length: 5 }, () => repo.getProductBySlug(prisma, "same-0")));
    for (const r of runs) expect(r!.images.map((i) => i.alt)).toEqual(["first", "second", "third"]);
  });

  it.each(["newest", "price-asc", "price-desc"] as const)("paginates tied products without duplicates or gaps (%s)", async (sort) => {
    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const res = await repo.listProducts(prisma, { sort, page, pageSize: 3 });
      seen.push(...res.items.map((i) => i.slug));
    }
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });
});
