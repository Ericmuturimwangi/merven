import { z } from "zod";

// Customer and basket input for checkout. Prices and totals sent by the
// browser are never trusted: `expectedTotalMinor` is only used to detect that
// the server's price differs from what the customer reviewed.

export const MAX_QUANTITY_PER_LINE = 5;
export const MAX_LINES = 10;

/** Kenyan mobile numbers in any common form -> E.164 (+2547XXXXXXXX / +2541XXXXXXXX). */
export function normaliseKenyanPhone(raw: string): string | null {
  const digits = raw.replace(/[\s()-]/g, "");
  const m = digits.match(/^(?:\+?254|0)?([17]\d{8})$/);
  return m ? `+254${m[1]}` : null;
}

export const basketItemSchema = z.object({
  variantId: z.string().trim().regex(/^[a-z0-9]{1,64}$/, "Invalid item"),
  quantity: z.coerce.number().int("Quantity must be a whole number").min(1).max(MAX_QUANTITY_PER_LINE),
});

export const checkoutInputSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80, "Name is too long"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .pipe(z.email("Enter a valid email address")),
  phone: z
    .string()
    .trim()
    .transform((v, ctx) => {
      const n = normaliseKenyanPhone(v);
      if (!n) {
        ctx.addIssue({ code: "custom", message: "Enter a Kenyan mobile number, e.g. 0712 345 678" });
        return z.NEVER;
      }
      return n;
    }),
  items: z.array(basketItemSchema).min(1, "Your basket is empty").max(MAX_LINES),
  expectedTotalMinor: z.coerce.number().int().min(0),
});
export type CheckoutInput = z.output<typeof checkoutInputSchema>;

/** "variantId:qty,variantId:qty" from the URL -> basket items (invalid parts dropped). */
export function parseBasketParam(param: string | undefined): { variantId: string; quantity: number }[] {
  if (!param) return [];
  const out = new Map<string, number>();
  for (const part of param.split(",").slice(0, MAX_LINES)) {
    const [variantId, qty] = part.split(":");
    const parsed = basketItemSchema.safeParse({ variantId, quantity: qty ?? "1" });
    if (parsed.success) out.set(parsed.data.variantId, Math.min(MAX_QUANTITY_PER_LINE, (out.get(parsed.data.variantId) ?? 0) + parsed.data.quantity));
  }
  return [...out].map(([variantId, quantity]) => ({ variantId, quantity }));
}

export function basketParam(items: { variantId: string; quantity: number }[]): string {
  return items.map((i) => `${i.variantId}:${i.quantity}`).join(",");
}
