import Link from "next/link";
import type { ProductSort } from "@/server/catalogue/repository";

const SORT_LABELS: Record<ProductSort, string> = {
  newest: "Newest",
  "price-asc": "Price: low to high",
  "price-desc": "Price: high to low",
};

function href(base: string, params: Record<string, string | number | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "" && v !== 1 && v !== "newest") qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${base}?${s}` : base;
}

export function SortLinks({ base, current, query }: { base: string; current: ProductSort; query?: string }) {
  return (
    <nav aria-label="Sort products" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {(Object.keys(SORT_LABELS) as ProductSort[]).map((sort) => (
        <Link
          key={sort}
          href={href(base, { q: query, sort })}
          aria-current={sort === current ? "true" : undefined}
          className={sort === current ? "link-underline text-charcoal" : "text-stone hover:text-charcoal"}
          scroll={false}
        >
          {SORT_LABELS[sort]}
        </Link>
      ))}
    </nav>
  );
}

export function Pagination({
  base,
  page,
  pageCount,
  sort,
  query,
}: {
  base: string;
  page: number;
  pageCount: number;
  sort: ProductSort;
  query?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-16 flex items-center justify-center gap-8 text-sm">
      {page > 1 ? (
        <Link className="link-underline" href={href(base, { q: query, sort, page: page - 1 })}>
          Previous
        </Link>
      ) : (
        <span className="text-line">Previous</span>
      )}
      <span className="text-stone">
        Page {page} of {pageCount}
      </span>
      {page < pageCount ? (
        <Link className="link-underline" href={href(base, { q: query, sort, page: page + 1 })}>
          Next
        </Link>
      ) : (
        <span className="text-line">Next</span>
      )}
    </nav>
  );
}

export function parseListingParams(sp: Record<string, string | string[] | undefined>) {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const sortRaw = one(sp.sort);
  const sort: ProductSort = sortRaw === "price-asc" || sortRaw === "price-desc" ? sortRaw : "newest";
  const pageNum = Number.parseInt(one(sp.page), 10);
  const page = Number.isFinite(pageNum) && pageNum > 0 && pageNum < 1000 ? pageNum : 1;
  const q = one(sp.q).trim().slice(0, 80);
  return { sort, page, q };
}
