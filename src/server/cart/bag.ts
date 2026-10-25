import { basketItemSchema, MAX_LINES, MAX_QUANTITY_PER_LINE } from "../orders/checkout-input";

// The shopping bag's cookie format. The bag lives in the customer's browser, so
// everything here is untrusted input: it only says WHICH variants and how many.
// Prices, names and stock always come from the database (see ./cart-service.ts).
// The bag uses checkout's limits and item rules, so it can never hold a line that
// checkout would refuse.
//
//   v1.<variantId>_<qty>[_<seenUnitPriceMinor>].<variantId>_<qty>…
//
// `seenUnitPriceMinor` is the unit price the customer last saw. It is display
// metadata only (to say "the price changed since you added this"), never a price.
// Only [a-z0-9._] is used, so the value passes through cookie encoding unchanged.

export const BAG_COOKIE = "merven_bag";
export const BAG_VERSION = "v1";
export const BAG_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const MAX_BAG_LINES = MAX_LINES;
export const MAX_BAG_QUANTITY = MAX_QUANTITY_PER_LINE;
/** Comfortably above the largest valid bag (about 780 characters); anything longer was not written by us. */
export const MAX_BAG_COOKIE_LENGTH = 1024;

export type BagLine = { variantId: string; quantity: number; seenUnitPriceMinor: number | null };

/** `discarded` is true when some or all of the stored value could not be used. */
export type ParsedBag = { lines: BagLine[]; discarded: boolean };

const LINE = /^([^_]+)_(\d{1,2})(?:_(\d{1,9}))?$/;

/** Never throws: an invalid value yields an empty (or partial) bag. */
export function parseBag(raw: string | null | undefined): ParsedBag {
  if (!raw) return { lines: [], discarded: false };
  if (raw.length > MAX_BAG_COOKIE_LENGTH) return { lines: [], discarded: true };
  const [version, ...parts] = raw.split(".");
  if (version !== BAG_VERSION) return { lines: [], discarded: true };

  const lines = new Map<string, BagLine>();
  let discarded = false;
  for (const part of parts) {
    const m = LINE.exec(part);
    const item = m ? basketItemSchema.safeParse({ variantId: m[1], quantity: m[2] }) : null;
    if (!m || !item?.success) {
      discarded = true;
      continue;
    }
    const existing = lines.get(item.data.variantId);
    if (existing) {
      // Never written by us, but merge rather than fail; checkout's per-line cap applies.
      existing.quantity = Math.min(MAX_BAG_QUANTITY, existing.quantity + item.data.quantity);
      continue;
    }
    if (lines.size >= MAX_BAG_LINES) {
      discarded = true;
      continue;
    }
    lines.set(item.data.variantId, { variantId: item.data.variantId, quantity: item.data.quantity, seenUnitPriceMinor: m[3] ? Number(m[3]) : null });
  }
  return { lines: [...lines.values()], discarded };
}

export function serializeBag(lines: BagLine[]): string {
  const parts = lines.map((l) => `${l.variantId}_${l.quantity}${l.seenUnitPriceMinor == null ? "" : `_${l.seenUnitPriceMinor}`}`);
  return [BAG_VERSION, ...parts].join(".");
}

/** Replaces the line for the same variant, or appends it. */
export function withLine(lines: BagLine[], line: BagLine): BagLine[] {
  return lines.some((l) => l.variantId === line.variantId) ? lines.map((l) => (l.variantId === line.variantId ? line : l)) : [...lines, line];
}

export function withoutLine(lines: BagLine[], variantId: string): BagLine[] {
  return lines.filter((l) => l.variantId !== variantId);
}

export function bagCount(lines: BagLine[]): { lines: number; items: number } {
  return { lines: lines.length, items: lines.reduce((n, l) => n + l.quantity, 0) };
}
