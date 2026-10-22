"use client";

import Link from "next/link";

// Shown when a storefront page fails on the server (for example the database
// is unreachable). Details stay in the server log; the reference matches it.
export default function StorefrontError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="font-display text-4xl font-medium">Something went wrong.</h1>
      <p className="mt-4 text-ink">This page couldn&rsquo;t be loaded just now. Please try again in a moment.</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-6">
        <button type="button" onClick={() => retry()} className="min-h-11 bg-forest px-6 text-sm text-white hover:bg-forest-deep">
          Try again
        </button>
        <Link href="/" className="link-underline text-sm">
          Return home
        </Link>
      </div>
      {digest && <p className="mt-10 text-xs text-stone">Reference: {digest}</p>}
    </div>
  );
}
