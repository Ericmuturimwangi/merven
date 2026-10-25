import { z } from "zod";
import { parseKESToMinor } from "../money";
import { SLUG_PATTERN } from "../slug";

// Schemas shared by admin forms and the server actions that receive them.
// The server always re-validates; client-side use is only for early feedback.

const trimmed = (min: number, max: number, label: string) =>
  z
    .string({ error: `${label} is required` })
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be at most ${max} characters`)
    .optional()
    .transform((v) => (v ? v : null));

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .max(80)
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || SLUG_PATTERN.test(v), "Use lowercase letters, numbers and single hyphens");

const priceField = (label: string) =>
  z
    .string({ error: `${label} is required` })
    .transform((v, ctx) => {
      const minor = parseKESToMinor(v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: `${label} must be an amount in KES, e.g. 4500` });
        return z.NEVER;
      }
      return minor;
    });

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.literal("false"), z.literal("")])
  .optional()
  .transform((v) => v === "on" || v === "true");

const id = z.string().trim().min(1).max(64).regex(/^[a-z0-9]+$/i, "Invalid id");

export const productInputSchema = z.object({
  name: trimmed(2, 120, "Name"),
  slug: slugField,
  description: trimmed(10, 5000, "Description"),
  details: optionalText(3000, "Details"),
  categoryId: id,
  price: priceField("Price").refine((v) => v > 0, "Price must be greater than zero"),
  featured: checkbox,
});
export type ProductInput = z.output<typeof productInputSchema>;

export const variantInputSchema = z.object({
  size: trimmed(1, 20, "Size"),
  colour: trimmed(1, 40, "Colour"),
  colourHex: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => v === null || /^#[0-9a-f]{6}$/.test(v), "Colour swatch must be a hex value like #1f1d1b"),
  sku: z
    .string()
    .trim()
    .toUpperCase()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^[A-Z0-9-]{3,40}$/.test(v), "SKU may only contain A–Z, 0–9 and hyphens"),
  price: z
    .string()
    .optional()
    .transform((v, ctx) => {
      if (!v || !v.trim()) return null;
      const minor = parseKESToMinor(v);
      if (minor === null) {
        ctx.addIssue({ code: "custom", message: "Price override must be an amount in KES" });
        return z.NEVER;
      }
      return minor;
    }),
  stock: z.coerce
    .number({ error: "Stock must be a whole number" })
    .int("Stock must be a whole number")
    .min(0, "Stock cannot be negative")
    .max(100_000, "Stock looks too large"),
  active: checkbox,
});
export type VariantInput = z.output<typeof variantInputSchema>;

export const stockUpdateSchema = z.object({
  variantId: id,
  stock: variantInputSchema.shape.stock,
});

export const categoryInputSchema = z.object({
  name: trimmed(2, 60, "Name"),
  slug: slugField,
  description: optionalText(500, "Description"),
  sortOrder: z.coerce.number().int().min(0).max(1000).default(0),
});
export type CategoryInput = z.output<typeof categoryInputSchema>;

export const imageAltSchema = z.object({
  alt: trimmed(3, 200, "Image description"),
});

/** The colour a photo shows: one of the product's variant colours, or empty for "any colour". */
export const imageColourSchema = z.object({
  colour: z
    .string()
    .trim()
    .max(40, "Colour is too long")
    .transform((v) => (v === "" ? null : v)),
});

export const idSchema = id;

export const searchQuerySchema = z
  .string()
  .trim()
  .max(80)
  .catch("");

/** Converts FormData into a plain object of string values (files are dropped). */
export function formDataToObject(form: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string" && !key.startsWith("$ACTION")) out[key] = value;
  }
  return out;
}

export type FieldErrors = Record<string, string[] | undefined>;

export function fieldErrors(error: z.ZodError): FieldErrors {
  return z.flattenError(error).fieldErrors as FieldErrors;
}
