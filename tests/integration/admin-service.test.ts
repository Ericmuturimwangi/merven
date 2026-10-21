import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as service from "@/server/admin/catalogue-service";
import { productInputSchema, variantInputSchema } from "@/lib/validation/catalogue";
import { hasTestDb, makeCategory, resetDb, testPrisma } from "../support/db";

describe.skipIf(!hasTestDb)("admin catalogue rules", () => {
  const prisma = testPrisma();
  let categoryId: string;

  const productInput = (overrides: Record<string, string> = {}) =>
    productInputSchema.parse({
      name: "Amani Wrap Dress",
      description: "A wrap dress in fluid crepe.",
      categoryId,
      price: "6500",
      ...overrides,
    });
  const variantInput = (overrides: Record<string, string> = {}) =>
    variantInputSchema.parse({ size: "M", colour: "Emerald", stock: "3", active: "true", ...overrides });

  beforeEach(async () => {
    await resetDb(prisma);
    categoryId = (await makeCategory(prisma)).id;
  });
  afterAll(() => prisma.$disconnect());

  it("creates products as drafts with a generated, unique slug", async () => {
    const a = await service.createProduct(prisma, productInput());
    const b = await service.createProduct(prisma, productInput());
    expect(a.slug).toBe("amani-wrap-dress");
    expect(b.slug).toBe("amani-wrap-dress-2");
    expect((await prisma.product.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DRAFT");
  });

  it("rejects an unknown category", async () => {
    await expect(service.createProduct(prisma, productInput({ categoryId: "doesnotexist" }))).rejects.toThrow(/valid category/);
  });

  it("requires an image and an active variant before publishing", async () => {
    const { id } = await service.createProduct(prisma, productInput());
    await expect(service.setProductStatus(prisma, id, "PUBLISHED")).rejects.toThrow(/image/);
    await service.addProductImage(prisma, id, { key: "k", url: "/media/products/x.webp", width: 800, height: 1000, alt: "Front" });
    await expect(service.setProductStatus(prisma, id, "PUBLISHED")).rejects.toThrow(/size\/colour/);
    await service.addVariant(prisma, id, variantInput({ active: "false" }));
    await expect(service.setProductStatus(prisma, id, "PUBLISHED")).rejects.toThrow(/size\/colour/);
    await service.addVariant(prisma, id, variantInput({ size: "L" }));
    const published = await service.setProductStatus(prisma, id, "PUBLISHED");
    expect(published.status).toBe("PUBLISHED");
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).publishedAt).not.toBeNull();
  });

  it("freezes the slug once published, but allows changes while still a draft", async () => {
    const { id } = await service.createProduct(prisma, productInput());
    await service.updateProduct(prisma, id, productInput({ slug: "renamed-dress" }));
    expect((await prisma.product.findUniqueOrThrow({ where: { id } })).slug).toBe("renamed-dress");

    await service.addProductImage(prisma, id, { key: "k", url: "/u.webp", width: 800, height: 1000, alt: "Front" });
    await service.addVariant(prisma, id, variantInput());
    await service.setProductStatus(prisma, id, "PUBLISHED");
    await service.setProductStatus(prisma, id, "DRAFT");
    await expect(service.updateProduct(prisma, id, productInput({ slug: "another-slug" }))).rejects.toThrow(/slug can't change/);
  });

  it("unfeatures archived products and refuses to feature them", async () => {
    const { id } = await service.createProduct(prisma, productInput({ featured: "on" }));
    await service.setProductStatus(prisma, id, "ARCHIVED");
    const archived = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(archived).toMatchObject({ status: "ARCHIVED", featured: false });
    await expect(service.setProductFeatured(prisma, id, true)).rejects.toThrow(/Archived/);
  });

  it("generates SKUs and rejects duplicate variants", async () => {
    const { id } = await service.createProduct(prisma, productInput());
    await service.addVariant(prisma, id, variantInput());
    const v = await prisma.productVariant.findFirstOrThrow({ where: { productId: id } });
    expect(v.sku).toMatch(/^MRV-[A-Z0-9-]+$/);
    await expect(service.addVariant(prisma, id, variantInput())).rejects.toThrow(/already exists/);
  });

  it("keeps a published product's last image", async () => {
    const { id } = await service.createProduct(prisma, productInput());
    const img = await service.addProductImage(prisma, id, { key: "k", url: "/u.webp", width: 800, height: 1000, alt: "Front" });
    await service.addVariant(prisma, id, variantInput());
    await service.setProductStatus(prisma, id, "PUBLISHED");
    await expect(service.deleteImage(prisma, img.id)).rejects.toThrow(/at least one image/);
  });

  it("reorders images", async () => {
    const { id } = await service.createProduct(prisma, productInput());
    const a = await service.addProductImage(prisma, id, { key: "a", url: "/a.webp", width: 800, height: 1000, alt: "A" });
    const b = await service.addProductImage(prisma, id, { key: "b", url: "/b.webp", width: 800, height: 1000, alt: "B" });
    await service.moveImage(prisma, b.id, "up");
    const order = await prisma.productImage.findMany({ where: { productId: id }, orderBy: { sortOrder: "asc" } });
    expect(order.map((i) => i.id)).toEqual([b.id, a.id]);
  });

  it("deletes an empty category directly", async () => {
    const empty = await service.createCategory(prisma, { name: "Empty", slug: null, description: null, sortOrder: 0 });
    expect(await service.deleteCategory(prisma, empty.id)).toEqual({ moved: 0 });
    expect(await prisma.category.findUnique({ where: { id: empty.id } })).toBeNull();
  });

  it("requires a valid destination before deleting a category that has products", async () => {
    await service.createProduct(prisma, productInput());
    await expect(service.deleteCategory(prisma, categoryId)).rejects.toThrow(/Choose a category to move/);
    await expect(service.deleteCategory(prisma, categoryId, categoryId)).rejects.toThrow(/different category/);
    await expect(service.deleteCategory(prisma, categoryId, "doesnotexist")).rejects.toThrow(/no longer exists/);
    expect(await prisma.category.findUnique({ where: { id: categoryId } })).not.toBeNull();
  });

  it("moves every product (any status) to the destination, then deletes the category", async () => {
    const a = await service.createProduct(prisma, productInput());
    const b = await service.createProduct(prisma, productInput());
    await service.setProductStatus(prisma, b.id, "ARCHIVED");
    const target = await service.createCategory(prisma, { name: "Target", slug: null, description: null, sortOrder: 0 });

    expect(await service.deleteCategory(prisma, categoryId, target.id)).toEqual({ moved: 2 });
    expect(await prisma.category.findUnique({ where: { id: categoryId } })).toBeNull();
    const products = await prisma.product.findMany({ where: { id: { in: [a.id, b.id] } } });
    expect(products.map((p) => p.categoryId)).toEqual([target.id, target.id]);
  });
});
