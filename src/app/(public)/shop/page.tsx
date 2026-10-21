import type { Metadata } from "next";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/catalogue/grid-skeleton";
import { ProductListing } from "@/components/catalogue/product-listing";

export const metadata: Metadata = {
  title: "Shop the collection",
  description: "Dresses, tailoring, knitwear and occasion wear from Merven Fashions, with delivery across Kenya.",
  alternates: { canonical: "/shop" },
};

export default function ShopPage({ searchParams }: PageProps<"/shop">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
      <header className="mb-10">
        <p className="label text-stone">The collection</p>
        <h1 className="mt-3 font-display text-4xl sm:text-5xl">Shop all</h1>
      </header>
      <Suspense fallback={<GridSkeleton />}>
        <ProductListing base="/shop" searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
