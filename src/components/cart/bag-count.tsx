import { prefetch } from "next/cache";
import { bagCount } from "@/server/cart/bag";
import { readBag } from "@/server/cart/bag-store";
import { BagLink } from "./bag-link";

// The visitor's bag link, read from the bag cookie. Render it inside <Suspense>
// with `<BagLink count={null} />` as the fallback: `prefetch()` keeps this
// per-visitor part out of the shared App Shell, so the shell stays static.
// Setting the cookie in a bag action re-renders it with the new count.
export async function BagCount({ className }: { className?: string }) {
  await prefetch();
  const { lines } = await readBag(); // an invalid cookie reads as an empty bag
  return <BagLink count={bagCount(lines).items} className={className} />;
}
