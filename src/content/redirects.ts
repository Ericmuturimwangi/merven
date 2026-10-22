// Permanent redirects for renamed catalogue URLs (e.g. a product slug that
// changes after publication). Empty until the owner approves slug changes.
// Example: { from: "/products/old-slug", to: "/products/new-slug" }
// Old URLs live on in shared links and past WhatsApp enquiries, so keep entries.

export type CatalogueRedirect = { from: string; to: string };

export const catalogueRedirects: CatalogueRedirect[] = [];

const PATH = /^\/(products|shop)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Validates the list and converts it to Next.js redirects. Throws on mistakes so a bad list fails the build. */
export function toNextRedirects(list: CatalogueRedirect[]) {
  const sources = new Set<string>();
  for (const r of list) {
    if (!PATH.test(r.from) || !PATH.test(r.to)) throw new Error(`Invalid redirect path: ${r.from} -> ${r.to}`);
    if (r.from === r.to) throw new Error(`Redirect points to itself: ${r.from}`);
    if (sources.has(r.from)) throw new Error(`Duplicate redirect source: ${r.from}`);
    sources.add(r.from);
  }
  for (const r of list) {
    if (sources.has(r.to)) throw new Error(`Redirect chain: ${r.to} is itself redirected; point ${r.from} at the final URL`);
  }
  return list.map((r) => ({ source: r.from, destination: r.to, permanent: true }));
}
