import { safeErrorFields } from "@/lib/error-report";
import { after, connection } from "next/server";
import { siteUrl } from "@/env";
import { settlePaidBag } from "@/server/cart/checkout-link-store";
import { handlePaystackCallback } from "@/server/payments/callback";
import { afterPaymentChange, paymentDeps } from "@/server/payments/runtime";

export async function GET(request: Request) {
  // Always per request: never prerender this handler (payment config is read at runtime).
  await connection();
  const deps = await paymentDeps();
  if (!deps) return Response.redirect(`${siteUrl()}/checkout/unknown`, 303);
  const url = new URL(request.url);
  const { location, result } = await handlePaystackCallback(deps, url.searchParams.get("reference") ?? url.searchParams.get("trxref"));
  if (result && result.outcome !== "unverified") after(() => afterPaymentChange(result, { revalidate: true }));
  // After verification: if the order linked to this visitor's bag is now PAID in
  // the database, remove the paid lines. The redirect itself proves nothing.
  try {
    await settlePaidBag(deps.prisma);
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "bag_settle_failed", ...safeErrorFields(e) }));
  }
  // Redirect to our own configured origin only (never the request Host).
  return Response.redirect(`${siteUrl()}${location}`, 303);
}
