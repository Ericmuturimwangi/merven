import Link from "next/link";
import { getProducts } from "@/server/catalogue/queries";
import { Pagination, SortLinks, parseListingParams } from "./listing-controls";
import { ProductGrid } from "./product-card";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Product results for /shop, /shop/[category] and /search. Reads searchParams, so render inside <Suspense>. */
export async function ProductListing({
  base,
  searchParams,
  categorySlug,
  searchMode = false,
}: {
  base: string;
  searchParams: SearchParams;
  categorySlug?: string;
  searchMode?: boolean;
}) {
  const { sort, page, q } = parseListingParams(await searchParams);
  if (searchMode && !q) {
    return <p className="text-stone">Type a word above, such as &ldquo;linen&rdquo;, &ldquo;dress&rdquo; or a colour.</p>;
  }
  const result = await getProducts({ categorySlug, query: searchMode ? q : undefined, sort, page });

  return (
    <>
      <div className="mb-8 flex flex-col gap-4 border-b border-line pb-5 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-stone" aria-live="polite">
          {searchMode ? (
            <>
              {result.total} {result.total === 1 ? "result" : "results"} for &ldquo;{q}&rdquo;
            </>
          ) : (
            <>
              {result.total} {result.total === 1 ? "piece" : "pieces"}
            </>
          )}
        </p>
        {result.total > 1 && <SortLinks base={base} current={sort} query={searchMode ? q : undefined} />}
      </div>
      {result.items.length > 0 ? (
        <ProductGrid products={result.items} priorityCount={4} />
      ) : (
        <div className="py-16 text-center">
          <p className="font-display text-2xl">Nothing here just yet.</p>
          <Link href="/shop" className="link-underline mt-4 inline-block text-sm">
            Browse the full collection
          </Link>
        </div>
      )}
      <Pagination base={base} page={result.page} pageCount={result.pageCount} sort={sort} query={searchMode ? q : undefined} />
    </>
  );
}
