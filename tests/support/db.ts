import "dotenv/config";
import { createPrismaClient, type PrismaClient } from "@/server/prisma-client";
import { assertSafe, SERVER_FACTS_SQL, type ServerFacts } from "./test-db-guard";

export const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);

export function testPrisma(): PrismaClient {
  return createPrismaClient(process.env.TEST_DATABASE_URL!);
}

type TruncateClient = Pick<PrismaClient, "$transaction">;

/** Empties every table, but only after the server confirms (in the same transaction) this is the local merven_test database. */
export async function resetDb(prisma: TruncateClient) {
  await prisma.$transaction(async (tx) => {
    assertSafe((await tx.$queryRawUnsafe<ServerFacts[]>(SERVER_FACTS_SQL))[0]);
    await tx.$executeRawUnsafe(
      'TRUNCATE "email_notification", "webhook_event", "payment_attempt", "order_item", "order", "product_image", "product_variant", "product", "category", "admin_session", "admin_account", "admin_user", "rate_limit" RESTART IDENTITY CASCADE',
    );
  });
}

let n = 0;
export async function makeCategory(prisma: PrismaClient, name = `Category ${++n}`) {
  return prisma.category.create({ data: { name, slug: `cat-${n}-${Date.now()}` } });
}

export async function makeProduct(
  prisma: PrismaClient,
  opts: {
    categoryId: string;
    slug: string;
    status?: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    featured?: boolean;
    priceMinor?: number;
    name?: string;
    variants?: { size: string; colour: string; stock: number; active?: boolean; priceMinor?: number | null }[];
    images?: number;
  },
) {
  const status = opts.status ?? "PUBLISHED";
  return prisma.product.create({
    data: {
      slug: opts.slug,
      name: opts.name ?? opts.slug.replace(/-/g, " "),
      description: "A test product description.",
      priceMinor: opts.priceMinor ?? 500000,
      status,
      featured: opts.featured ?? false,
      publishedAt: status === "PUBLISHED" ? new Date() : null,
      categoryId: opts.categoryId,
      variants: {
        create: (opts.variants ?? [{ size: "M", colour: "Black", stock: 5 }]).map((v, i) => ({
          sku: `${opts.slug}-${i}`.toUpperCase(),
          size: v.size,
          colour: v.colour,
          stock: v.stock,
          active: v.active ?? true,
          priceMinor: v.priceMinor ?? null,
        })),
      },
      images: {
        create: Array.from({ length: opts.images ?? 1 }, (_, i) => ({
          storageKey: `test:${opts.slug}-${i}`,
          url: `/placeholders/${opts.slug}-${i}.webp`,
          alt: "test image",
          width: 1200,
          height: 1500,
          sortOrder: i,
        })),
      },
    },
  });
}
