import type { PrismaClient } from "@/generated/prisma/client";
import { effectivePrice, LOW_STOCK_THRESHOLD, type PublicImage } from "../catalogue/repository";
import { MAX_BAG_LINES, MAX_BAG_QUANTITY, withLine, type BagLine } from "./bag";

// Bag operations against trusted catalogue data. Rules:
// - Only published products with active, in-stock variants can be added.
// - A line never exceeds min(stock, 5). A request above that adds what is
//   possible and says so ("limited"); it is never silently raised or lowered.
// - Lines that became unavailable stay in the bag and are reported, never
//   silently removed. The customer removes them.
// - Customers see availability, a low-stock flag and a quantity cap (at most 5),
//   never raw stock counts.
// - Nothing here touches orders or payments.

export type LineStatus = "available" | "insufficient_stock" | "sold_out" | "unavailable" | "not_found";

type VariantFacts = {
  id: string;
  size: string;
  colour: string;
  stock: number;
  active: boolean;
  unitPriceMinor: number;
  product: { name: string; slug: string; status: string; publishedAt: Date | null; image: PublicImage | null };
};

async function variantFacts(prisma: PrismaClient, ids: string[]): Promise<Map<string, VariantFacts>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.productVariant.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      size: true,
      colour: true,
      stock: true,
      active: true,
      priceMinor: true,
      product: {
        select: {
          name: true,
          slug: true,
          status: true,
          publishedAt: true,
          priceMinor: true,
          images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }, { id: "asc" }], take: 1, select: { url: true, alt: true, width: true, height: true } },
        },
      },
    },
  });
  return new Map(
    rows.map((v) => [
      v.id,
      {
        id: v.id,
        size: v.size,
        colour: v.colour,
        stock: v.stock,
        active: v.active,
        unitPriceMinor: effectivePrice(v.product.priceMinor, v.priceMinor),
        product: { name: v.product.name, slug: v.product.slug, status: v.product.status, publishedAt: v.product.publishedAt, image: v.product.images[0] ?? null },
      },
    ]),
  );
}

/** Sellable now, and how many one line may hold (0 when not sellable). */
function sellability(v: VariantFacts | undefined): { status: Exclude<LineStatus, "insufficient_stock" | "available"> | "ok"; maxQuantity: number } {
  if (!v) return { status: "not_found", maxQuantity: 0 };
  if (!v.active || v.product.status !== "PUBLISHED") return { status: "unavailable", maxQuantity: 0 };
  if (v.stock <= 0) return { status: "sold_out", maxQuantity: 0 };
  return { status: "ok", maxQuantity: Math.min(v.stock, MAX_BAG_QUANTITY) };
}

// --- Reading -----------------------------------------------------------------------

export type BagViewLine = {
  variantId: string;
  quantity: number;
  status: LineStatus;
  /** Most this line can hold right now (0 when the variant can't be bought). */
  maxQuantity: number;
  lowStock: boolean;
  /** Current server price; null when the variant can't be bought. */
  unitPriceMinor: number | null;
  lineTotalMinor: number | null;
  /** The price differs from the one the customer last saw (display only). */
  priceChanged: boolean;
  seenUnitPriceMinor: number | null;
  /** Null for a variant that no longer exists or whose product was never published. */
  display: { productName: string; productSlug: string; size: string; colour: string; image: PublicImage | null } | null;
};

export type BagView = {
  lines: BagViewLine[];
  /** Total of the lines that can be bought as they are. Display only: checkout prices again. */
  subtotalMinor: number;
  /** Every line can be bought in its current quantity. */
  ready: boolean;
};

/** Describes every bag line against the database, without dropping any. */
export async function describeBag(prisma: PrismaClient, lines: BagLine[]): Promise<BagView> {
  const facts = await variantFacts(prisma, lines.map((l) => l.variantId));
  const view = lines.map((line): BagViewLine => {
    const v = facts.get(line.variantId);
    const { status: sellable, maxQuantity } = sellability(v);
    const status: LineStatus = sellable !== "ok" ? sellable : line.quantity > maxQuantity ? "insufficient_stock" : "available";
    const unit = sellable === "ok" && v ? v.unitPriceMinor : null;
    return {
      variantId: line.variantId,
      quantity: line.quantity,
      status,
      maxQuantity,
      lowStock: sellable === "ok" && !!v && v.stock <= LOW_STOCK_THRESHOLD,
      unitPriceMinor: unit,
      lineTotalMinor: unit == null ? null : unit * line.quantity,
      priceChanged: unit != null && line.seenUnitPriceMinor != null && line.seenUnitPriceMinor !== unit,
      seenUnitPriceMinor: line.seenUnitPriceMinor,
      // A never-published product is never described, even if its id is guessed.
      display: v && v.product.publishedAt ? { productName: v.product.name, productSlug: v.product.slug, size: v.size, colour: v.colour, image: v.product.image } : null,
    };
  });
  return {
    lines: view,
    subtotalMinor: view.reduce((sum, l) => sum + (l.status === "available" ? (l.lineTotalMinor ?? 0) : 0), 0),
    ready: view.length > 0 && view.every((l) => l.status === "available"),
  };
}

// --- Changing ----------------------------------------------------------------------

export type BagChange =
  | { ok: true; outcome: "added" | "updated" | "limited"; lines: BagLine[]; quantity: number; maxQuantity: number }
  | { ok: false; outcome: "not_found" | "unavailable" | "sold_out" | "at_limit" | "bag_full" | "not_in_bag"; maxQuantity: number };

/** Adds `quantity` of a variant, merging with an existing line. */
export async function addToBag(prisma: PrismaClient, lines: BagLine[], variantId: string, quantity: number): Promise<BagChange> {
  const existing = lines.find((l) => l.variantId === variantId);
  if (!existing && lines.length >= MAX_BAG_LINES) return { ok: false, outcome: "bag_full", maxQuantity: 0 };

  const v = (await variantFacts(prisma, [variantId])).get(variantId);
  const { status, maxQuantity } = sellability(v);
  if (status !== "ok" || !v) return { ok: false, outcome: status === "ok" ? "not_found" : status, maxQuantity };

  const have = existing?.quantity ?? 0;
  // Already at (or, after a stock drop, above) the cap: change nothing.
  if (have >= maxQuantity) return { ok: false, outcome: "at_limit", maxQuantity };
  const next = Math.min(have + quantity, maxQuantity);
  return {
    ok: true,
    outcome: next < have + quantity ? "limited" : "added",
    lines: withLine(lines, { variantId, quantity: next, seenUnitPriceMinor: v.unitPriceMinor }),
    quantity: next,
    maxQuantity,
  };
}

/** Sets a line's quantity (1–5), capped at what can be bought now. */
export async function updateBagLine(prisma: PrismaClient, lines: BagLine[], variantId: string, quantity: number): Promise<BagChange> {
  if (!lines.some((l) => l.variantId === variantId)) return { ok: false, outcome: "not_in_bag", maxQuantity: 0 };

  const v = (await variantFacts(prisma, [variantId])).get(variantId);
  const { status, maxQuantity } = sellability(v);
  // An unavailable line is kept as it is, so it can still be reported; the customer removes it.
  if (status !== "ok" || !v) return { ok: false, outcome: status === "ok" ? "not_found" : status, maxQuantity };

  const next = Math.min(quantity, maxQuantity);
  return {
    ok: true,
    outcome: next < quantity ? "limited" : "updated",
    // The customer is looking at the current price when changing the quantity.
    lines: withLine(lines, { variantId, quantity: next, seenUnitPriceMinor: v.unitPriceMinor }),
    quantity: next,
    maxQuantity,
  };
}
