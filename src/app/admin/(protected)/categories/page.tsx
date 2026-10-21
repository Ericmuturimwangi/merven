import type { Metadata } from "next";
import { CategoryManager } from "@/components/admin/category-manager";
import { listAdminCategories } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Categories" };

export default async function CategoriesPage() {
  const categories = await listAdminCategories();
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Categories</h1>
      <p className="text-sm text-stone">Categories with no published products are hidden from the public site.</p>
      <CategoryManager
        categories={categories.map((c) => ({
          id: c.id,
          name: c.name,
          slug: c.slug,
          description: c.description,
          sortOrder: c.sortOrder,
          productCount: c._count.products,
        }))}
      />
    </div>
  );
}
