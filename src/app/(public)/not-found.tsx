import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <p className="label text-stone">404</p>
      <h1 className="mt-4 font-display text-4xl">This page isn&rsquo;t here.</h1>
      <p className="mt-4 text-ink">The piece may have sold through or moved.</p>
      <Link href="/shop" className="link-underline mt-8 inline-block text-sm">
        Browse the collection
      </Link>
    </div>
  );
}
