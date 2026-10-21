import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "../db";
import * as repo from "./repository";

// Cached public catalogue reads. Admin mutations call `updateTag(CATALOGUE_TAG)`
// so stock, prices and visibility changes show up immediately.

export const CATALOGUE_TAG = "catalogue";

export async function getCategories() {
  "use cache";
  cacheTag(CATALOGUE_TAG);
  cacheLife("hours");
  return repo.listCategories(db);
}

export async function getCategory(slug: string) {
  "use cache";
  cacheTag(CATALOGUE_TAG);
  cacheLife("hours");
  return repo.getCategoryBySlug(db, slug);
}

export async function getFeaturedProducts(limit = 8) {
  "use cache";
  cacheTag(CATALOGUE_TAG);
  cacheLife("hours");
  return repo.listFeaturedProducts(db, limit);
}

export async function getProducts(opts: repo.ListProductsOptions) {
  "use cache";
  cacheTag(CATALOGUE_TAG);
  if (opts.query) cacheLife("minutes");
  else cacheLife("hours");
  return repo.listProducts(db, opts);
}

export async function getProduct(slug: string) {
  "use cache";
  cacheTag(CATALOGUE_TAG);
  cacheLife("hours");
  return repo.getProductBySlug(db, slug);
}

export async function getPublishedSlugs() {
  "use cache";
  cacheTag(CATALOGUE_TAG);
  cacheLife("hours");
  return repo.listPublishedSlugs(db);
}
