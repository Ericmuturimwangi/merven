import { describe, expect, it } from "vitest";
import { slugify } from "@/lib/slug";
import { categoryInputSchema, productInputSchema, stockUpdateSchema, variantInputSchema } from "@/lib/validation/catalogue";

const validProduct = {
  name: "Amani Wrap Dress",
  slug: "",
  description: "A lovely wrap dress in crepe.",
  details: "",
  categoryId: "clx123abc",
  price: "6,500",
  featured: "on",
};

describe("productInputSchema", () => {
  it("accepts valid input and converts price to minor units", () => {
    const r = productInputSchema.parse(validProduct);
    expect(r.price).toBe(650000);
    expect(r.slug).toBeNull();
    expect(r.details).toBeNull();
    expect(r.featured).toBe(true);
  });
  it.each([
    ["price", "abc"],
    ["price", "-5"],
    ["price", "0"],
    ["name", " "],
    ["description", "short"],
    ["slug", "Not A Slug!"],
    ["slug", "double--hyphen"],
    ["categoryId", "'; drop table product; --"],
  ])("rejects invalid %s %j", (field, value) => {
    const r = productInputSchema.safeParse({ ...validProduct, [field]: value });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some((i) => i.path[0] === field)).toBe(true);
  });
  it("ignores unknown fields such as status", () => {
    const r = productInputSchema.parse({ ...validProduct, status: "PUBLISHED" });
    expect(r).not.toHaveProperty("status");
  });
});

describe("variantInputSchema", () => {
  const valid = { size: "M", colour: "Emerald", colourHex: "#1F5B45", sku: "mrv-1", price: "", stock: "3", active: "on" };
  it("normalises values", () => {
    const r = variantInputSchema.parse(valid);
    expect(r).toMatchObject({ colourHex: "#1f5b45", sku: "MRV-1", price: null, stock: 3, active: true });
  });
  it.each([
    ["stock", "-1"],
    ["stock", "1.5"],
    ["stock", "lots"],
    ["colourHex", "red"],
    ["sku", "has space"],
    ["price", "free"],
  ])("rejects invalid %s %j", (field, value) => {
    expect(variantInputSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });
  it("stock updates reject negatives", () => {
    expect(stockUpdateSchema.safeParse({ variantId: "abc123", stock: "-3" }).success).toBe(false);
    expect(stockUpdateSchema.parse({ variantId: "abc123", stock: "0" }).stock).toBe(0);
  });
});

describe("categoryInputSchema and slugify", () => {
  it("validates categories", () => {
    expect(categoryInputSchema.parse({ name: "Dresses", sortOrder: "2" })).toMatchObject({ slug: null, sortOrder: 2 });
    expect(categoryInputSchema.safeParse({ name: "D" }).success).toBe(false);
  });
  it("slugifies names", () => {
    expect(slugify("Kitenge Panel Fit & Flare Dress")).toBe("kitenge-panel-fit-and-flare-dress");
    expect(slugify("  Café  Crème!! ")).toBe("cafe-creme");
  });
});
