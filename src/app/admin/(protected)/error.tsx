"use client";

// Admin pages: a failed load must not look like an empty catalogue.
export default function AdminError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : null;
  return (
    <div className="max-w-xl space-y-4 py-12">
      <h1 className="font-display text-3xl">This page couldn&rsquo;t be loaded.</h1>
      <p className="text-sm text-ink">
        Nothing was changed. This is usually a temporary problem reaching the database. Try again; if it keeps happening,
        share the reference below.
      </p>
      <button type="button" onClick={() => retry()} className="bg-charcoal px-4 py-2 text-sm text-ivory">
        Try again
      </button>
      {digest && <p className="text-xs text-stone">Reference: {digest}</p>}
    </div>
  );
}
