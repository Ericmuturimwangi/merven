import "server-only";
import type { Prisma, ProductStatus } from "@/generated/prisma/client";
import { requireAdmin } from "../auth/session";
import { db } from "../db";

// Admin reads. Never cached, and each one re-checks authorisation so that a
// page or component can't accidentally expose drafts without a session.

export async function listAdminProducts(opts: { status?: ProductStatus; q?: string }) {
  await requireAdmin();
  const where: Prisma.ProductWhereInput = {};
  if (opts.status) where.status = opts.status;
  if (opts.q) where.name = { contains: opts.q, mode: "insensitive" };
  return db.product.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      slug: true,
      status: true,
      featured: true,
      priceMinor: true,
      updatedAt: true,
      category: { select: { name: true } },
      images: { orderBy: { sortOrder: "asc" }, take: 1, select: { url: true, alt: true } },
      variants: { where: { active: true }, select: { stock: true } },
    },
  });
}

export async function getAdminProduct(id: string) {
  await requireAdmin();
  return db.product.findUnique({
    where: { id },
    include: {
      category: { select: { id: true, name: true } },
      images: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
      variants: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
}

export async function listAdminCategories() {
  await requireAdmin();
  return db.category.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { products: true } } },
  });
}

export async function getAdminStats() {
  await requireAdmin();
  const [byStatus, outOfStock] = await Promise.all([
    db.product.groupBy({ by: ["status"], _count: { _all: true } }),
    db.productVariant.count({ where: { active: true, stock: 0, product: { status: "PUBLISHED" } } }),
  ]);
  const count = (s: ProductStatus) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  return { published: count("PUBLISHED"), draft: count("DRAFT"), archived: count("ARCHIVED"), outOfStock };
}

export async function listAdminOrders(opts: { status?: "PENDING_PAYMENT" | "PAID" | "CANCELLED"; attention?: boolean }) {
  await requireAdmin();
  return db.order.findMany({
    where: { ...(opts.status ? { status: opts.status } : {}), ...(opts.attention ? { needsAttention: { not: null } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: {
      id: true,
      reference: true,
      testMode: true,
      status: true,
      stockStatus: true,
      customerName: true,
      totalMinor: true,
      createdAt: true,
      paidAt: true,
      needsAttention: true,
      notifications: { select: { status: true } },
      _count: { select: { items: true, payments: true } },
    },
  });
}

export async function getAdminOrder(id: string) {
  await requireAdmin();
  return db.order.findUnique({
    where: { id },
    include: {
      items: true,
      payments: { orderBy: { createdAt: "asc" } },
      notifications: true,
    },
  });
}
