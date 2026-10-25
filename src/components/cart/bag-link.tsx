import Link from "next/link";

export const BAG_PATH = "/bag";

/** Screen-reader name for the bag link. `null` means the count isn't known yet. */
export function bagLabel(count: number | null): string {
  if (count === null) return "Bag";
  if (count === 0) return "Bag, empty";
  return `Bag, ${count} ${count === 1 ? "item" : "items"}`;
}

/** The bag link with its item count (total units). Renders on the server or inside client navigation. */
export function BagLink({ count, className }: { count: number | null; className?: string }) {
  return (
    <Link href={BAG_PATH} aria-label={bagLabel(count)} className={className}>
      Bag
      {count !== null && count > 0 && (
        <span aria-hidden className="ml-1 tabular-nums">
          ({count})
        </span>
      )}
    </Link>
  );
}
