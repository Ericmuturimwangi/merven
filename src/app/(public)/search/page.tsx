import type { Metadata } from "next";
import { Suspense } from "react";
import { GridSkeleton } from "@/components/catalogue/grid-skeleton";
import { ProductListing } from "@/components/catalogue/product-listing";
import { SearchBox } from "@/components/catalogue/search-box";

export const metadata: Metadata = {
  title: "Search",
  robots: { index: false, follow: true },
};

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
      <header className="mb-10">
        <h1 className="font-display text-4xl sm:text-5xl">Search</h1>
        <Suspense fallback={<div className="mt-6 h-12 max-w-xl border-b border-charcoal" />}>
          <SearchBox searchParams={searchParams} />
        </Suspense>
      </header>
      <Suspense fallback={<GridSkeleton count={4} />}>
        <ProductListing base="/search" searchParams={searchParams} searchMode />
      </Suspense>
    </div>
  );
}
