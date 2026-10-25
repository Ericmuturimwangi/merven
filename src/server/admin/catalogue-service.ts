import { Prisma, type PrismaClient, type ProductStatus } from "@/generated/prisma/client";
import { slugify } from "@/lib/slug";
import type { CategoryInput, ProductInput, VariantInput } from "@/lib/validation/catalogue";
import { MAX_IMAGES_PER_PRODUCT } from "../images/validate";

// Admin write operations. Callers (server actions) are responsible for
// authorisation and input validation; this layer enforces business rules.

export class DomainError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function uniqueSlug(
  exists: (slug: string) => Promise<boolean>,
  base: string,
): Promise<string> {
  const root = base || "item";
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  throw new DomainError("Could not generate a unique slug; please enter one.", "slug");
}

async function requireCategory(prisma: PrismaClient, id: string) {
  const category = await prisma.category.findUnique({ where: { id }, select: { id: true } });
  if (!category) throw new DomainError("Choose a valid category.", "categoryId");
}

// --- Products ----------------------------------------------------------------

export async function createProduct(prisma: PrismaClient, input: ProductInput) {
  await requireCategory(prisma, input.categoryId);
  const exists = async (slug: string) => !!(await prisma.product.findUnique({ where: { slug }, select: { id: true } }));
  let slug: string;
  if (input.slug) {
    if (await exists(input.slug)) throw new DomainError("That slug is already in use.", "slug");
    slug = input.slug;
  } else {
    slug = await uniqueSlug(exists, slugify(input.name));
  }
  try {
    return await prisma.product.create({
      data: {
        slug,
        name: input.name,
        description: input.description,
        details: input.details,
        categoryId: input.categoryId,
        priceMinor: input.price,
        featured: input.featured,
        status: "DRAFT",
      },
      select: { id: true, slug: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("That slug is already in use.", "slug");
    throw e;
  }
}

export async function updateProduct(prisma: PrismaClient, id: string, input: ProductInput) {
  const current = await prisma.product.findUnique({ where: { id }, select: { slug: true, publishedAt: true } });
  if (!current) throw new DomainError("Product not found.");
  await requireCategory(prisma, input.categoryId);

  let slug = current.slug;
  if (input.slug && input.slug !== current.slug) {
    // Published URLs are stable: changing them would break shared links and search results.
    if (current.publishedAt) throw new DomainError("The slug can't change once a product has been published.", "slug");
    slug = input.slug;
  }
  try {
    return await prisma.product.update({
      where: { id },
      data: {
        slug,
        name: input.name,
        description: input.description,
        details: input.details,
        categoryId: input.categoryId,
        priceMinor: input.price,
        featured: input.featured,
      },
      select: { id: true, slug: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("That slug is already in use.", "slug");
    throw e;
  }
}

export async function setProductStatus(prisma: PrismaClient, id: string, status: ProductStatus) {
  const product = await prisma.product.findUnique({
    where: { id },
    select: {
      publishedAt: true,
      _count: { select: { images: true, variants: { where: { active: true } } } },
    },
  });
  if (!product) throw new DomainError("Product not found.");

  if (status === "PUBLISHED") {
    if (product._count.images === 0) throw new DomainError("Add at least one image before publishing.");
    if (product._count.variants === 0) throw new DomainError("Add at least one active size/colour before publishing.");
    return prisma.product.update({
      where: { id },
      data: { status, publishedAt: product.publishedAt ?? new Date(), archivedAt: null },
      select: { id: true, slug: true, status: true },
    });
  }
  if (status === "ARCHIVED") {
    return prisma.product.update({
      where: { id },
      data: { status, archivedAt: new Date(), featured: false },
      select: { id: true, slug: true, status: true },
    });
  }
  return prisma.product.update({
    where: { id },
    data: { status, archivedAt: null },
    select: { id: true, slug: true, status: true },
  });
}

export async function setProductFeatured(prisma: PrismaClient, id: string, featured: boolean) {
  const product = await prisma.product.findUnique({ where: { id }, select: { status: true } });
  if (!product) throw new DomainError("Product not found.");
  if (featured && product.status === "ARCHIVED") throw new DomainError("Archived products can't be featured.");
  return prisma.product.update({ where: { id }, data: { featured }, select: { id: true, slug: true } });
}

// --- Variants & inventory --------------------------------------------------------

function generateSku(productSlug: string, size: string, colour: string): string {
  const part = (s: string, n: number) => s.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, n) || "X";
  const base = productSlug.split("-").map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4) || "MRV";
  return `MRV-${base}-${part(colour, 3)}-${part(size, 4)}`;
}

export async function addVariant(prisma: PrismaClient, productId: string, input: VariantInput) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true, _count: { select: { variants: true } } },
  });
  if (!product) throw new DomainError("Product not found.");
  let sku = input.sku ?? generateSku(product.slug, input.size, input.colour);
  if (!input.sku && (await prisma.productVariant.findUnique({ where: { sku }, select: { id: true } }))) {
    sku = `${sku}-${product._count.variants + 1}`;
  }
  try {
    return await prisma.productVariant.create({
      data: {
        productId,
        sku,
        size: input.size,
        colour: input.colour,
        colourHex: input.colourHex,
        priceMinor: input.price,
        stock: input.stock,
        active: input.active,
        sortOrder: product._count.variants,
      },
      select: { id: true, productId: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("That size and colour combination or SKU already exists.");
    throw e;
  }
}

export async function updateVariant(prisma: PrismaClient, variantId: string, input: VariantInput) {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { sku: true } });
  if (!variant) throw new DomainError("Variant not found.");
  try {
    return await prisma.productVariant.update({
      where: { id: variantId },
      data: {
        sku: input.sku ?? variant.sku,
        size: input.size,
        colour: input.colour,
        colourHex: input.colourHex,
        priceMinor: input.price,
        stock: input.stock,
        active: input.active,
      },
      select: { id: true, productId: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("That size and colour combination or SKU already exists.");
    throw e;
  }
}

export async function setVariantStock(prisma: PrismaClient, variantId: string, stock: number) {
  if (!Number.isInteger(stock) || stock < 0) throw new DomainError("Stock cannot be negative.", "stock");
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId }, select: { id: true } });
  if (!variant) throw new DomainError("Variant not found.");
  return prisma.productVariant.update({ where: { id: variantId }, data: { stock }, select: { id: true, productId: true } });
}

// --- Images ----------------------------------------------------------------------

export async function assertCanAddImage(prisma: PrismaClient, productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { _count: { select: { images: true } } },
  });
  if (!product) throw new DomainError("Product not found.");
  if (product._count.images >= MAX_IMAGES_PER_PRODUCT)
    throw new DomainError(`A product can have at most ${MAX_IMAGES_PER_PRODUCT} images.`);
  return product._count.images;
}

/** A photo's colour must be one of the product's variant colours (any variant, active or not), or null. */
async function assertImageColour(prisma: PrismaClient, productId: string, colour: string | null) {
  if (colour === null) return;
  const match = await prisma.productVariant.findFirst({ where: { productId, colour }, select: { id: true } });
  if (!match) throw new DomainError("Choose one of this product's colours.", "colour");
}

export async function addProductImage(
  prisma: PrismaClient,
  productId: string,
  image: { key: string; url: string; width: number; height: number; alt: string; colour?: string | null },
) {
  const count = await assertCanAddImage(prisma, productId);
  await assertImageColour(prisma, productId, image.colour ?? null);
  return prisma.productImage.create({
    data: {
      productId,
      storageKey: image.key,
      url: image.url,
      width: image.width,
      height: image.height,
      alt: image.alt,
      colour: image.colour ?? null,
      sortOrder: count,
    },
    select: { id: true, productId: true },
  });
}

export async function updateImageAlt(prisma: PrismaClient, imageId: string, alt: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId }, select: { id: true } });
  if (!image) throw new DomainError("Image not found.");
  return prisma.productImage.update({ where: { id: imageId }, data: { alt }, select: { id: true, productId: true } });
}

/** Sets (or clears, with null) the colour a photo shows. */
export async function updateImageColour(prisma: PrismaClient, imageId: string, colour: string | null) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId }, select: { productId: true } });
  if (!image) throw new DomainError("Image not found.");
  await assertImageColour(prisma, image.productId, colour);
  return prisma.productImage.update({ where: { id: imageId }, data: { colour }, select: { id: true, productId: true } });
}

export async function moveImage(prisma: PrismaClient, imageId: string, direction: "up" | "down") {
  const image = await prisma.productImage.findUnique({ where: { id: imageId }, select: { productId: true } });
  if (!image) throw new DomainError("Image not found.");
  return prisma.$transaction(async (tx) => {
    const images = await tx.productImage.findMany({
      where: { productId: image.productId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true },
    });
    const ids = images.map((i) => i.id);
    const from = ids.indexOf(imageId);
    const to = direction === "up" ? from - 1 : from + 1;
    if (to >= 0 && to < ids.length) [ids[from], ids[to]] = [ids[to], ids[from]];
    await Promise.all(ids.map((id, sortOrder) => tx.productImage.update({ where: { id }, data: { sortOrder } })));
    return { id: imageId, productId: image.productId };
  }, { maxWait: 10_000, timeout: 15_000 }); // tolerate cold remote connections
}

/** Deletes the image row and returns its storage key so the caller can remove the file. */
export async function deleteImage(prisma: PrismaClient, imageId: string) {
  const image = await prisma.productImage.findUnique({
    where: { id: imageId },
    select: { productId: true, storageKey: true, product: { select: { status: true, _count: { select: { images: true } } } } },
  });
  if (!image) throw new DomainError("Image not found.");
  if (image.product.status === "PUBLISHED" && image.product._count.images <= 1)
    throw new DomainError("A published product needs at least one image. Add another or unpublish first.");
  await prisma.productImage.delete({ where: { id: imageId } });
  return { productId: image.productId, storageKey: image.storageKey };
}

// --- Categories --------------------------------------------------------------------

export async function createCategory(prisma: PrismaClient, input: CategoryInput) {
  const exists = async (slug: string) => !!(await prisma.category.findUnique({ where: { slug }, select: { id: true } }));
  if (input.slug && (await exists(input.slug))) throw new DomainError("That slug is already in use.", "slug");
  const slug = input.slug ?? (await uniqueSlug(exists, slugify(input.name)));
  return prisma.category.create({
    data: { name: input.name, slug, description: input.description, sortOrder: input.sortOrder },
    select: { id: true },
  });
}

export async function updateCategory(prisma: PrismaClient, id: string, input: CategoryInput) {
  const current = await prisma.category.findUnique({
    where: { id },
    select: { slug: true, _count: { select: { products: { where: { status: "PUBLISHED" } } } } },
  });
  if (!current) throw new DomainError("Category not found.");
  // Like product slugs, a live category URL stays stable: changing it would
  // break shared /shop links (there is no automatic redirect).
  if (input.slug && input.slug !== current.slug && current._count.products > 0) {
    throw new DomainError("The URL can't change while this category has published products.", "slug");
  }
  try {
    return await prisma.category.update({
      where: { id },
      data: { name: input.name, slug: input.slug ?? current.slug, description: input.description, sortOrder: input.sortOrder },
      select: { id: true },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new DomainError("That slug is already in use.", "slug");
    throw e;
  }
}

/**
 * Deletes a category. If it still has products (in any status), they are first
 * moved to `moveProductsTo`, in the same transaction, so no product is ever
 * left without a category.
 */
export async function deleteCategory(prisma: PrismaClient, id: string, moveProductsTo?: string | null) {
  const category = await prisma.category.findUnique({ where: { id }, select: { _count: { select: { products: true } } } });
  if (!category) throw new DomainError("Category not found.");
  if (category._count.products === 0) {
    await prisma.category.delete({ where: { id } });
    return { moved: 0 };
  }
  if (!moveProductsTo) {
    throw new DomainError("Choose a category to move this category's products to.", "moveProductsTo");
  }
  if (moveProductsTo === id) throw new DomainError("Choose a different category to move the products to.", "moveProductsTo");
  const target = await prisma.category.findUnique({ where: { id: moveProductsTo }, select: { id: true } });
  if (!target) throw new DomainError("The destination category no longer exists.", "moveProductsTo");

  const [moved] = await prisma.$transaction([
    prisma.product.updateMany({ where: { categoryId: id }, data: { categoryId: target.id } }),
    prisma.category.delete({ where: { id } }),
  ]);
  return { moved: moved.count };
}
