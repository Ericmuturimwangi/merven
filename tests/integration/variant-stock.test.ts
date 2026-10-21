import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DomainError, setVariantStock } from "@/server/admin/catalogue-service";
import * as repo from "@/server/catalogue/repository";
import { hasTestDb, makeCategory, makeProduct, resetDb, testPrisma } from "../support/db";

describe.skipIf(!hasTestDb)("variant stock and availability", () => {
  const prisma = testPrisma();
  let categoryId: string;

  beforeAll(async () => {
    await resetDb(prisma);
    categoryId = (await makeCategory(prisma)).id;
    await makeProduct(prisma, {
      categoryId,
      slug: "mixed-stock",
      priceMinor: 600000,
      variants: [
        { size: "S", colour: "Black", stock: 10 },
        { size: "M", colour: "Black", stock: 2 },
        { size: "L", colour: "Black", stock: 0 },
        { size: "XL", colour: "Black", stock: 7, active: false },
        { size: "16", colour: "Black", stock: 1, priceMinor: 650000 },
      ],
    });
    await makeProduct(prisma, {
      categoryId,
      slug: "sold-out",
      variants: [
        { size: "S", colour: "Red", stock: 0 },
        { size: "M", colour: "Red", stock: 9, active: false },
      ],
    });
  });
  afterAll(() => prisma.$disconnect());

  it("exposes per-variant availability, low-stock flags and effective prices", async () => {
    const p = (await repo.getProductBySlug(prisma, "mixed-stock"))!;
    const bySize = Object.fromEntries(p.variants.map((v) => [v.size, v]));
    expect(Object.keys(bySize).sort()).toEqual(["16", "L", "M", "S"]); // inactive XL hidden
    expect(bySize.S).toMatchObject({ available: true, lowStock: false, priceMinor: 600000 });
    expect(bySize.M).toMatchObject({ available: true, lowStock: true });
    expect(bySize.L).toMatchObject({ available: false, lowStock: false });
    expect(bySize["16"]).toMatchObject({ available: true, priceMinor: 650000 });
    expect(p).toMatchObject({ inStock: true, priceFromMinor: 600000, priceToMinor: 650000 });
  });

  it("never exposes raw stock counts publicly", async () => {
    const p = (await repo.getProductBySlug(prisma, "mixed-stock"))!;
    for (const v of p.variants) expect(v).not.toHaveProperty("stock");
  });

  it("treats a product as sold out when no active variant has stock (inactive stock doesn't count)", async () => {
    const p = (await repo.getProductBySlug(prisma, "sold-out"))!;
    expect(p.inStock).toBe(false);
    const card = (await repo.listProducts(prisma)).items.find((i) => i.slug === "sold-out")!;
    expect(card.inStock).toBe(false);
  });

  it("updates availability when stock changes", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { product: { slug: "sold-out" }, size: "S" } });
    await setVariantStock(prisma, variant.id, 3);
    expect((await repo.getProductBySlug(prisma, "sold-out"))!.inStock).toBe(true);
    await setVariantStock(prisma, variant.id, 0);
    expect((await repo.getProductBySlug(prisma, "sold-out"))!.inStock).toBe(false);
  });

  it("rejects negative stock in the service and in the database", async () => {
    const variant = await prisma.productVariant.findFirstOrThrow({ where: { product: { slug: "mixed-stock" }, size: "S" } });
    await expect(setVariantStock(prisma, variant.id, -1)).rejects.toBeInstanceOf(DomainError);
    await expect(prisma.productVariant.update({ where: { id: variant.id }, data: { stock: -5 } })).rejects.toThrow(
      /product_variant_stock_non_negative|check constraint/i,
    );
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stock).toBe(10);
  });

  it("rejects duplicate size/colour combinations for a product", async () => {
    const product = await prisma.product.findUniqueOrThrow({ where: { slug: "mixed-stock" } });
    await expect(
      prisma.productVariant.create({ data: { productId: product.id, sku: "DUP-1", size: "S", colour: "Black", stock: 1 } }),
    ).rejects.toThrow();
  });
});
