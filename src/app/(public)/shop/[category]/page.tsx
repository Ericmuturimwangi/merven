import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/catalogue/grid-skeleton";
import { ProductListing } from "@/components/catalogue/product-listing";
import { getCategories, getCategory } from "@/server/catalogue/queries";

// Prebuild every category with published products (see products/[slug]).
export async function generateStaticParams() {
  const categories = await getCategories();
  return categories.length ? categories.map((c) => ({ category: c.slug })) : [{ category: "__none__" }];
}

export async function generateMetadata({ params }: PageProps<"/shop/[category]">): Promise<Metadata> {
  const { category: slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();
  return {
    title: category.name,
    description: category.description ?? `Shop ${category.name.toLowerCase()} at Merven Fashions, delivered across Kenya.`,
    alternates: { canonical: `/shop/${category.slug}` },
  };
}

async function CategoryContent({ params, searchParams }: PageProps<"/shop/[category]">) {
  const { category: slug } = await params;
  const category = await getCategory(slug);
  if (!category) notFound();
  return (
    <>
      <header className="mb-10">
        <p className="label text-stone">Category</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">{category.name}</h1>
        {category.description && <p className="mt-4 max-w-xl text-ink">{category.description}</p>}
      </header>
      <ProductListing base={`/shop/${category.slug}`} categorySlug={category.slug} searchParams={searchParams} />
    </>
  );
}

export default function CategoryPage(props: PageProps<"/shop/[category]">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
      <Suspense
        fallback={
          <>
            <div className="mb-10 h-24" />
            <GridSkeleton />
          </>
        }
      >
        <CategoryContent {...props} />
      </Suspense>
    </div>
  );
}
