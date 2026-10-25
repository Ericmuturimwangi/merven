"use server";

import { safeErrorFields } from "@/lib/error-report";
import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  categoryInputSchema,
  fieldErrors,
  formDataToObject,
  idSchema,
  imageAltSchema,
  imageColourSchema,
  productInputSchema,
  stockUpdateSchema,
  variantInputSchema,
} from "@/lib/validation/catalogue";
import { requireAdmin } from "../auth/session";
import { CATALOGUE_TAG } from "../catalogue/queries";
import { db } from "../db";
import { imageStorage } from "../images/storage";
import { processImageUpload } from "../images/validate";
import type { ActionState } from "./action-state";
import * as service from "./catalogue-service";
import { configuredMailer } from "../notifications/mailer";
import { processReceipts, requeueReceipt } from "../notifications/receipts";
import { ownerAlertEmail, processOwnerAlerts } from "../notifications/owner-alerts";
import { reconcileOrder } from "../orders/order-service";
import { paymentDeps, runPaymentRecovery } from "../payments/runtime";
import { siteUrl } from "@/env";

// Every export here is a server action reachable by POST from any client, so
// each one starts with requireAdmin() and validates all input with Zod.

function failure(e: unknown): ActionState {
  if (e instanceof service.DomainError) {
    return { ok: false, message: e.message, errors: e.field ? { [e.field]: [e.message] } : undefined };
  }
  console.error(JSON.stringify({ level: "error", event: "admin_action_failed", ...safeErrorFields(e) }));
  return { ok: false, message: "Something went wrong. Please try again." };
}

function invalid(error: z.ZodError): ActionState {
  return { ok: false, message: "Please correct the highlighted fields.", errors: fieldErrors(error) };
}

function done(message: string): ActionState {
  updateTag(CATALOGUE_TAG);
  refresh();
  return { ok: true, message };
}

const statusSchema = z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]);

// --- Products ----------------------------------------------------------------

export async function createProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = productInputSchema.safeParse(formDataToObject(form));
  if (!parsed.success) return invalid(parsed.error);
  let id: string;
  try {
    ({ id } = await service.createProduct(db, parsed.data));
  } catch (e) {
    return failure(e);
  }
  updateTag(CATALOGUE_TAG);
  redirect(`/admin/products/${id}?created=1`);
}

export async function updateProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  const parsed = productInputSchema.safeParse(formDataToObject(form));
  if (!id.success) return { ok: false, message: "Invalid product." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    await service.updateProduct(db, id.data, parsed.data);
  } catch (e) {
    return failure(e);
  }
  return done("Product saved.");
}

export async function setProductStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  const status = statusSchema.safeParse(form.get("status"));
  if (!id.success || !status.success) return { ok: false, message: "Invalid request." };
  try {
    await service.setProductStatus(db, id.data, status.data);
  } catch (e) {
    return failure(e);
  }
  const labels = { DRAFT: "Moved to draft.", PUBLISHED: "Published.", ARCHIVED: "Archived." } as const;
  return done(labels[status.data]);
}

export async function setProductFeaturedAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  const featured = z.enum(["true", "false"]).safeParse(form.get("featured"));
  if (!id.success || !featured.success) return { ok: false, message: "Invalid request." };
  try {
    await service.setProductFeatured(db, id.data, featured.data === "true");
  } catch (e) {
    return failure(e);
  }
  return done(featured.data === "true" ? "Featured on the homepage." : "Removed from featured.");
}

// --- Variants ------------------------------------------------------------------

export async function addVariantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const productId = idSchema.safeParse(form.get("productId"));
  const parsed = variantInputSchema.safeParse(formDataToObject(form));
  if (!productId.success) return { ok: false, message: "Invalid product." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    await service.addVariant(db, productId.data, parsed.data);
  } catch (e) {
    return failure(e);
  }
  return done("Variant added.");
}

export async function updateVariantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const variantId = idSchema.safeParse(form.get("variantId"));
  const parsed = variantInputSchema.safeParse(formDataToObject(form));
  if (!variantId.success) return { ok: false, message: "Invalid variant." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    await service.updateVariant(db, variantId.data, parsed.data);
  } catch (e) {
    return failure(e);
  }
  return done("Variant saved.");
}

export async function setVariantStockAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = stockUpdateSchema.safeParse(formDataToObject(form));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await service.setVariantStock(db, parsed.data.variantId, parsed.data.stock);
  } catch (e) {
    return failure(e);
  }
  return done("Stock updated.");
}

// --- Images ----------------------------------------------------------------------

export async function uploadImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const productId = idSchema.safeParse(form.get("productId"));
  const alt = imageAltSchema.safeParse({ alt: form.get("alt") });
  const colour = imageColourSchema.safeParse({ colour: form.get("colour") ?? "" });
  const file = form.get("file");
  if (!productId.success) return { ok: false, message: "Invalid product." };
  if (!alt.success) return invalid(alt.error);
  if (!colour.success) return invalid(colour.error);
  if (!(file instanceof Blob)) return { ok: false, message: "Choose an image to upload.", errors: { file: ["Choose an image"] } };

  try {
    await service.assertCanAddImage(db, productId.data);
  } catch (e) {
    return failure(e);
  }
  const processed = await processImageUpload(file);
  if (!processed.ok) return { ok: false, message: processed.error, errors: { file: [processed.error] } };

  const storage = imageStorage();
  let stored: { key: string; url: string };
  try {
    stored = await storage.put(processed.image, { productId: productId.data });
  } catch (e) {
    return failure(e);
  }
  try {
    await service.addProductImage(db, productId.data, {
      ...stored,
      width: processed.image.width,
      height: processed.image.height,
      alt: alt.data.alt,
      colour: colour.data.colour,
    });
  } catch (e) {
    await storage.remove(stored.key).catch(() => undefined);
    return failure(e);
  }
  return done("Image uploaded.");
}

/** Saves a photo's description and the colour it shows. */
export async function updateImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const imageId = idSchema.safeParse(form.get("imageId"));
  const alt = imageAltSchema.safeParse({ alt: form.get("alt") });
  const colour = imageColourSchema.safeParse({ colour: form.get("colour") ?? "" });
  if (!imageId.success) return { ok: false, message: "Invalid image." };
  if (!alt.success) return invalid(alt.error);
  if (!colour.success) return invalid(colour.error);
  try {
    await service.updateImageColour(db, imageId.data, colour.data.colour);
    await service.updateImageAlt(db, imageId.data, alt.data.alt);
  } catch (e) {
    return failure(e);
  }
  return done("Image saved.");
}

export async function moveImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const imageId = idSchema.safeParse(form.get("imageId"));
  const direction = z.enum(["up", "down"]).safeParse(form.get("direction"));
  if (!imageId.success || !direction.success) return { ok: false, message: "Invalid request." };
  try {
    await service.moveImage(db, imageId.data, direction.data);
  } catch (e) {
    return failure(e);
  }
  return done("Image order updated.");
}

export async function deleteImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const imageId = idSchema.safeParse(form.get("imageId"));
  if (!imageId.success) return { ok: false, message: "Invalid image." };
  try {
    const { storageKey } = await service.deleteImage(db, imageId.data);
    await imageStorage()
      .remove(storageKey)
      .catch((e) => console.error("[image cleanup]", e));
  } catch (e) {
    return failure(e);
  }
  return done("Image removed.");
}

// --- Categories ----------------------------------------------------------------------

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const parsed = categoryInputSchema.safeParse(formDataToObject(form));
  if (!parsed.success) return invalid(parsed.error);
  try {
    await service.createCategory(db, parsed.data);
  } catch (e) {
    return failure(e);
  }
  return done("Category created.");
}

export async function updateCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  const parsed = categoryInputSchema.safeParse(formDataToObject(form));
  if (!id.success) return { ok: false, message: "Invalid category." };
  if (!parsed.success) return invalid(parsed.error);
  try {
    await service.updateCategory(db, id.data, parsed.data);
  } catch (e) {
    return failure(e);
  }
  return done("Category saved.");
}

export async function deleteCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  const rawTarget = form.get("moveProductsTo");
  const moveTo = rawTarget ? idSchema.safeParse(rawTarget) : null;
  if (!id.success) return { ok: false, message: "Invalid category." };
  if (moveTo && !moveTo.success) return { ok: false, message: "Invalid destination category." };
  let moved = 0;
  try {
    ({ moved } = await service.deleteCategory(db, id.data, moveTo?.data ?? null));
  } catch (e) {
    return failure(e);
  }
  return done(moved ? `Category deleted. ${moved} product${moved === 1 ? "" : "s"} moved.` : "Category deleted.");
}

// --- Orders ----------------------------------------------------------------------

export async function recheckPaymentAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Invalid order." };
  const deps = await paymentDeps();
  if (!deps) return { ok: false, message: "Online payments are disabled, so Paystack can't be checked." };
  try {
    // Includes abandoned or failed attempts that reached Paystack: a late payment is found even if its webhook was lost.
    const res = await reconcileOrder(deps, id.data, { scope: "recoverable" });
    if (res.stockChanged) updateTag(CATALOGUE_TAG);
    if (res.receiptQueued) await processReceipts(db, configuredMailer(), { siteUrl: siteUrl(), orderId: id.data, limit: 1 });
    await processOwnerAlerts(db, configuredMailer(), { siteUrl: siteUrl(), ownerEmail: ownerAlertEmail(), limit: 5 });
    refresh();
    if (res.unverified > 0) return { ok: false, message: "Paystack couldn't be reached. Try again shortly." };
    return { ok: true, message: res.paid ? "Payment confirmed by Paystack." : "Checked with Paystack: not paid." };
  } catch (e) {
    return failure(e);
  }
}

export async function retryReceiptAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return { ok: false, message: "Invalid order." };
  const requeued = await requeueReceipt(db, id.data);
  if (requeued.count === 0) return { ok: false, message: "There is no unsent receipt for a paid order here." };
  const mailer = configuredMailer();
  if (!mailer) {
    refresh();
    return { ok: false, message: "Receipt queued, but no email provider is configured (EMAIL_PROVIDER)." };
  }
  const res = await processReceipts(db, mailer, { siteUrl: siteUrl(), orderId: id.data, limit: 1 });
  refresh();
  return res.sent ? { ok: true, message: "Receipt sent." } : { ok: false, message: "Sending failed; it will be retried automatically." };
}

/** Runs payment recovery now (the daily cron does the same): re-checks recent unpaid attempts with Paystack. */
export async function recoverPaymentsAction(): Promise<ActionState> {
  await requireAdmin();
  try {
    const res = await runPaymentRecovery({ limit: 10 });
    if ("disabled" in res) return { ok: false, message: "Online payments are disabled, so Paystack can't be checked." };
    if (res.stockChanged) updateTag(CATALOGUE_TAG);
    const mailer = configuredMailer();
    if (res.receiptQueued) await processReceipts(db, mailer, { siteUrl: siteUrl(), limit: 10 });
    await processOwnerAlerts(db, mailer, { siteUrl: siteUrl(), ownerEmail: ownerAlertEmail(), limit: 10 });
    refresh();
    const found = res.outcomes.paid ?? 0;
    const parts = [`Checked ${res.checked} payment attempt${res.checked === 1 ? "" : "s"} with Paystack`];
    if (found) parts.push(`${found} newly confirmed as paid`);
    if (res.unverified) parts.push(`${res.unverified} couldn't be checked (Paystack unreachable); they will be retried`);
    if (res.checked === 0 && !res.unverified) parts.push("nothing is due (each attempt is re-checked at most every 6 hours)");
    return { ok: res.unverified === 0, message: `${parts.join("; ")}.` };
  } catch (e) {
    return failure(e);
  }
}
