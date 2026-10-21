// Idempotent placeholder seed: upserts 6 categories and 30 published products.
import "dotenv/config";
import { createPrismaClient } from "../src/server/prisma-client";
import { slugify } from "../src/lib/slug";
import { seedCategories, seedProducts } from "./seed-data";

if (process.env.NODE_ENV === "production" && process.env.SEED_ALLOW_PRODUCTION !== "1") {
  console.error("Refusing to seed placeholder data in production. Set SEED_ALLOW_PRODUCTION=1 to override.");
  process.exit(1);
}

const prisma = createPrismaClient(process.env.DATABASE_URL!);

// Deterministic "random" stock so seeds are reproducible; roughly 1 in 7 sold out.
function stockFor(key: string): number {
  let h = 0;
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const n = h % 14;
  return n < 2 ? 0 : n < 4 ? n - 1 : n;
}

async function main() {
  const categoryIds = new Map<string, string>();
  for (const [i, c] of seedCategories.entries()) {
    const row = await prisma.category.upsert({
      where: { slug: c.slug },
      update: { name: c.name, description: c.description, sortOrder: i },
      create: { name: c.name, slug: c.slug, description: c.description, sortOrder: i },
    });
    categoryIds.set(c.slug, row.id);
  }

  const base = new Date("2026-10-01T08:00:00Z").getTime();
  for (const [i, p] of seedProducts.entries()) {
    const slug = slugify(p.name);
    const publishedAt = new Date(base + i * 3_600_000);
    const data = {
      name: p.name,
      description: p.description,
      details: p.details,
      priceMinor: p.priceKES * 100,
      featured: p.featured ?? false,
      categoryId: categoryIds.get(p.category)!,
      status: "PUBLISHED" as const,
      publishedAt,
    };
    const product = await prisma.product.upsert({
      where: { slug },
      update: data,
      create: { slug, ...data },
    });

    let order = 0;
    for (const c of p.colours) {
      for (const size of c.sizes) {
        const sku = `MRV-${String(i + 1).padStart(3, "0")}-${c.colour.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase()}-${size.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}`;
        const override = p.sizePrices?.[size];
        const variant = {
          size,
          colour: c.colour,
          colourHex: c.hex,
          priceMinor: override ? override * 100 : null,
          stock: stockFor(sku),
          active: true,
          sortOrder: order++,
        };
        await prisma.productVariant.upsert({
          where: { sku },
          update: variant,
          create: { sku, productId: product.id, ...variant },
        });
      }
    }

    await prisma.productImage.deleteMany({ where: { productId: product.id, storageKey: { startsWith: "placeholder:" } } });
    await prisma.productImage.createMany({
      data: [1, 2].map((n) => ({
        productId: product.id,
        storageKey: `placeholder:${slug}-${n}`,
        url: `/placeholders/${slug}-${n}.webp`,
        alt: n === 1 ? `${p.name} in ${p.colours[0].colour.toLowerCase()} (placeholder image)` : `Fabric detail of the ${p.name} (placeholder image)`,
        width: 1200,
        height: 1500,
        sortOrder: n - 1,
      })),
    });
  }

  const [products, variants] = await Promise.all([prisma.product.count(), prisma.productVariant.count()]);
  console.log(`Seeded ${seedCategories.length} categories, ${products} products, ${variants} variants.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
