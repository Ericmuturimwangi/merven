import type { Prisma, PrismaClient } from "@/generated/prisma/client";

// Public catalogue reads. Every query in this file must go through
// `publicProductWhere` so that draft and archived products are never exposed.

export const LOW_STOCK_THRESHOLD = 3;

export function publicProductWhere(extra: Prisma.ProductWhereInput = {}): Prisma.ProductWhereInput {
  return { AND: [{ status: "PUBLISHED" }, extra] };
}

export type ProductSort = "newest" | "price-asc" | "price-desc";
export const PRODUCT_SORTS: readonly ProductSort[] = ["newest", "price-asc", "price-desc"];

export type PublicImage = { url: string; alt: string; width: number; height: number };

export type PublicProductCard = {
  id: string;
  slug: string;
  name: string;
  category: { name: string; slug: string };
  priceFromMinor: number;
  priceToMinor: number;
  inStock: boolean;
  image: PublicImage | null;
  hoverImage: PublicImage | null;
};

export type PublicVariant = {
  id: string;
  sku: string;
  size: string;
  colour: string;
  colourHex: string | null;
  priceMinor: number;
  available: boolean;
  lowStock: boolean;
};

export type PublicProduct = Omit<PublicProductCard, "image" | "hoverImage"> & {
  description: string;
  details: string | null;
  images: PublicImage[];
  variants: PublicVariant[];
  updatedAt: Date;
};

export type PublicCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  productCount: number;
  /** First image of the category's featured (else newest) published product. */
  cover: PublicImage | null;
};

const cardSelect = {
  id: true,
  slug: true,
  name: true,
  priceMinor: true,
  category: { select: { name: true, slug: true } },
  images: { orderBy: { sortOrder: "asc" }, take: 2, select: { url: true, alt: true, width: true, height: true } },
  variants: { where: { active: true }, select: { stock: true, priceMinor: true } },
} satisfies Prisma.ProductSelect;

type CardRow = Prisma.ProductGetPayload<{ select: typeof cardSelect }>;

/** Effective price of a variant: its override, else the product price. */
export function effectivePrice(productPriceMinor: number, variantPriceMinor: number | null): number {
  return variantPriceMinor ?? productPriceMinor;
}

function priceRange(productPrice: number, variants: { priceMinor: number | null }[]) {
  const prices = variants.length ? variants.map((v) => effectivePrice(productPrice, v.priceMinor)) : [productPrice];
  return { priceFromMinor: Math.min(...prices), priceToMinor: Math.max(...prices) };
}

function toCard(row: CardRow): PublicProductCard {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    category: row.category,
    ...priceRange(row.priceMinor, row.variants),
    inStock: row.variants.some((v) => v.stock > 0),
    image: row.images[0] ?? null,
    hoverImage: row.images[1] ?? null,
  };
}

function orderBy(sort: ProductSort): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case "price-asc":
      return [{ priceMinor: "asc" }, { name: "asc" }];
    case "price-desc":
      return [{ priceMinor: "desc" }, { name: "asc" }];
    default:
      return [{ publishedAt: "desc" }, { createdAt: "desc" }];
  }
}

export async function listCategories(prisma: PrismaClient): Promise<PublicCategory[]> {
  const rows = await prisma.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      _count: { select: { products: { where: publicProductWhere() } } },
      products: {
        where: publicProductWhere({ images: { some: {} } }),
        orderBy: [{ featured: "desc" }, { publishedAt: "desc" }],
        take: 1,
        select: { images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true, width: true, height: true } } },
      },
    },
  });
  return rows
    .filter((c) => c._count.products > 0)
    .map(({ _count, products, ...c }) => ({ ...c, productCount: _count.products, cover: products[0]?.images[0] ?? null }));
}

export async function getCategoryBySlug(prisma: PrismaClient, slug: string) {
  return prisma.category.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true, description: true },
  });
}

export type ListProductsOptions = {
  categorySlug?: string;
  query?: string;
  sort?: ProductSort;
  page?: number;
  pageSize?: number;
};

export async function listProducts(prisma: PrismaClient, opts: ListProductsOptions = {}) {
  const pageSize = Math.min(Math.max(opts.pageSize ?? 24, 1), 60);
  const page = Math.max(Math.floor(opts.page ?? 1), 1);
  const filters: Prisma.ProductWhereInput[] = [];
  if (opts.categorySlug) filters.push({ category: { slug: opts.categorySlug } });
  const q = opts.query?.trim();
  if (q) {
    filters.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { category: { name: { contains: q, mode: "insensitive" } } },
        { variants: { some: { active: true, colour: { contains: q, mode: "insensitive" } } } },
      ],
    });
  }
  const where = publicProductWhere({ AND: filters });
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: orderBy(opts.sort ?? "newest"),
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: cardSelect,
    }),
  ]);
  return { items: rows.map(toCard), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function listFeaturedProducts(prisma: PrismaClient, limit = 8): Promise<PublicProductCard[]> {
  const rows = await prisma.product.findMany({
    where: publicProductWhere({ featured: true }),
    orderBy: [{ publishedAt: "desc" }],
    take: limit,
    select: cardSelect,
  });
  return rows.map(toCard);
}

export async function getProductBySlug(prisma: PrismaClient, slug: string): Promise<PublicProduct | null> {
  const row = await prisma.product.findFirst({
    where: publicProductWhere({ slug }),
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      details: true,
      priceMinor: true,
      updatedAt: true,
      category: { select: { name: true, slug: true } },
      images: { orderBy: { sortOrder: "asc" }, select: { url: true, alt: true, width: true, height: true } },
      variants: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, sku: true, size: true, colour: true, colourHex: true, priceMinor: true, stock: true },
      },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    details: row.details,
    updatedAt: row.updatedAt,
    category: row.category,
    images: row.images,
    ...priceRange(row.priceMinor, row.variants),
    inStock: row.variants.some((v) => v.stock > 0),
    variants: row.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      size: v.size,
      colour: v.colour,
      colourHex: v.colourHex,
      priceMinor: effectivePrice(row.priceMinor, v.priceMinor),
      available: v.stock > 0,
      lowStock: v.stock > 0 && v.stock <= LOW_STOCK_THRESHOLD,
    })),
  };
}

export async function listPublishedSlugs(prisma: PrismaClient) {
  return prisma.product.findMany({
    where: publicProductWhere(),
    select: { slug: true, updatedAt: true },
    orderBy: { publishedAt: "desc" },
  });
}
