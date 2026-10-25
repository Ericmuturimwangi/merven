import type { BagChange } from "./cart-service";

export type BagOutcome = BagChange["outcome"] | "removed" | "cleared" | "invalid" | "error";

export type BagActionState = {
  ok: boolean;
  outcome?: BagOutcome;
  message?: string;
  variantId?: string;
  /** The line's quantity after the action. */
  quantity?: number;
  /** Most the line can hold right now (at most 5); 0 when it can't be bought. */
  maxQuantity?: number;
  /** Bag size after the action, e.g. for the header count. */
  count?: { lines: number; items: number };
  /** Part of the stored bag was unreadable and has been dropped. */
  discarded?: boolean;
};

export const initialBagState: BagActionState = { ok: false };
