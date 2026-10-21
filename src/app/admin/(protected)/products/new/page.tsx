import type { Metadata } from "next";
import Link from "next/link";
import { ProductForm } from "@/components/admin/product-form";
import { listAdminCategories } from "@/server/admin/queries";

export const metadata: Metadata = { title: "New product" };

export default async function NewProductPage() {
  const categories = await listAdminCategories();
  return (
    <div className="max-w-2xl space-y-6">
      <Link href="/admin" className="text-sm text-stone hover:text-charcoal">
        ← Products
      </Link>
      <h1 className="font-display text-3xl">New product</h1>
      <p className="text-sm text-stone">Products start as drafts. Add images and sizes on the next screen, then publish.</p>
      {categories.length === 0 ? (
        <p className="text-sm">
          <Link href="/admin/categories" className="link-underline">Create a category</Link> first.
        </p>
      ) : (
        <ProductForm categories={categories.map((c) => ({ id: c.id, name: c.name }))} />
      )}
    </div>
  );
}
