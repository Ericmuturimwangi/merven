"use server";

import { safeErrorFields } from "@/lib/error-report";
import { db } from "../db";
import { orderStatusPath } from "../orders/access";
import { settlePaidBag } from "./checkout-link-store";

// Settles the bag after a payment the customer didn't return from (e.g. the
// webhook confirmed it). Called by /bag and /checkout when they see a link; the
// order's status in the database decides, never the caller.

export type SettleState = { settled: false } | { settled: true; reference: string; orderPath: string; kept: number };

export async function settleBagAction(): Promise<SettleState> {
  try {
    const s = await settlePaidBag(db);
    return s.outcome === "settled" ? { settled: true, reference: s.reference, orderPath: orderStatusPath(s.reference), kept: s.kept } : { settled: false };
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "bag_settle_failed", ...safeErrorFields(e) }));
    return { settled: false };
  }
}
