import Form from "next/form";
import { parseListingParams } from "./listing-controls";

export async function SearchBox({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { q } = parseListingParams(await searchParams);
  return (
    <Form action="/search" role="search" className="mt-6 flex max-w-xl items-end gap-4 border-b border-charcoal">
      <label htmlFor="q" className="sr-only">
        Search products
      </label>
      <input
        id="q"
        name="q"
        type="search"
        defaultValue={q}
        maxLength={80}
        placeholder="Dresses, linen, emerald…"
        className="w-full bg-transparent py-3 text-lg placeholder:text-stone focus:outline-none"
      />
      <button type="submit" className="pb-3 text-sm">
        Search
      </button>
    </Form>
  );
}
