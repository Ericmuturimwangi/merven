// Applies a reviewed catalogue copy patch (names, descriptions, image alt text,
// misleading colour swatches). Dry-run by default.
//
//   DATABASE_URL=… pnpm catalogue:patch                 # show what would change
//   DATABASE_URL=… pnpm catalogue:patch --apply         # back up, then apply
//
// Safety: every row must still hold the value it had when the patch was written,
// otherwise it is skipped (an admin edited it since). Current values are written
// to backups/ before anything changes, and all updates run in one transaction.
// Prices, stock, sizes, colour names, categories, slugs and images are untouched.
import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { z } from "zod";
import { createPrismaClient } from "../src/server/prisma-client";
import { patch } from "./catalogue-patches/2026-10-22-boutique-copy";

const textRules = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().min(10).max(5000),
});
const altRule = z.string().trim().min(3).max(200);

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } } });
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  const host = new URL(process.env.DATABASE_URL).hostname;
  console.log(`${values.apply ? "APPLYING" : "DRY RUN"} against ${host}\n`);

  try {
    for (const p of patch.products) textRules.parse(p.set);
    for (const i of patch.images) altRule.parse(i.alt);

    const ops = [];
    const backup: Record<string, unknown[]> = { products: [], images: [], variants: [] };
    let skipped = 0;

    for (const p of patch.products) {
      const cur = await prisma.product.findUnique({ where: { id: p.id }, select: { slug: true, name: true, description: true, details: true } });
      if (!cur || cur.name !== p.expect.name || cur.description !== p.expect.description) {
        console.log(`SKIP product ${p.id}: changed since the patch was written`);
        skipped++;
        continue;
      }
      backup.products.push({ id: p.id, ...cur });
      console.log(`/products/${cur.slug}\n  name:        ${cur.name}\n           →  ${p.set.name}\n  description: ${cur.description}\n           →  ${p.set.description}\n  details:     ${cur.details ?? "(none)"}\n           →  (cleared)\n`);
      ops.push(prisma.product.update({ where: { id: p.id }, data: p.set }));
    }

    for (const i of patch.images) {
      const cur = await prisma.productImage.findUnique({ where: { id: i.id }, select: { alt: true, productId: true } });
      if (!cur || cur.productId !== i.productId || cur.alt !== i.expectAlt) {
        console.log(`SKIP image ${i.id}: changed since the patch was written`);
        skipped++;
        continue;
      }
      backup.images.push({ id: i.id, alt: cur.alt });
      console.log(`image ${i.id}\n  alt: ${cur.alt}\n   →   ${i.alt}`);
      ops.push(prisma.productImage.update({ where: { id: i.id }, data: { alt: i.alt } }));
    }

    for (const v of patch.clearSwatches) {
      const cur = await prisma.productVariant.findUnique({ where: { id: v.variantId }, select: { colour: true, colourHex: true } });
      if (!cur || cur.colour !== v.expectColour || cur.colourHex !== v.expectHex) {
        console.log(`SKIP variant ${v.variantId}: changed since the patch was written`);
        skipped++;
        continue;
      }
      backup.variants.push({ id: v.variantId, colourHex: cur.colourHex });
      console.log(`variant ${v.variantId} (${cur.colour}): swatch ${cur.colourHex} → none`);
      ops.push(prisma.productVariant.update({ where: { id: v.variantId }, data: { colourHex: null } }));
    }

    console.log(`\n${ops.length} update(s) ready, ${skipped} skipped.`);
    if (!values.apply) {
      console.log("Dry run only: nothing was written. Re-run with --apply to make these changes.");
      return;
    }
    if (ops.length === 0) return;

    await mkdir("backups", { recursive: true, mode: 0o700 });
    const file = `backups/catalogue-patch-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    await writeFile(file, JSON.stringify(backup, null, 2), { mode: 0o600 });
    console.log(`Backup of current values written to ${file}`);

    await prisma.$queryRaw`select 1`; // open the connection before the transaction
    await prisma.$transaction(ops);
    console.log("Applied. Redeploy (or wait up to an hour) for cached storefront pages to show the new copy.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof z.ZodError ? z.prettifyError(e) : e instanceof Error ? e.message.replace(/postgres(ql)?:\/\/\S+/g, "<url>") : e);
  process.exit(1);
});
