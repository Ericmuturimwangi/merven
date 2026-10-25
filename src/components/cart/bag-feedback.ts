import type { BagActionState } from "@/server/cart/state";

export type BagFeedback = {
  tone: "success" | "notice" | "error";
  /** The server's message: nothing is claimed before the action has answered. */
  message: string;
  /** The piece is (or the problem is) in the bag, so "View bag" helps. */
  viewBag: boolean;
};

/** What to tell the customer after an add-to-bag result, or null when there is nothing to say. */
export function bagFeedback(state: BagActionState): BagFeedback | null {
  if (!state.outcome || !state.message) return null;
  switch (state.outcome) {
    case "added":
    case "updated":
      return { tone: "success", message: state.message, viewBag: true };
    case "limited":
    case "at_limit":
    case "bag_full":
      return { tone: "notice", message: state.message, viewBag: true };
    default:
      return { tone: "error", message: state.message, viewBag: false };
  }
}

/**
 * Feedback belongs to the variant it was about: after choosing another size or
 * colour, an earlier "Added" no longer applies. Results without a variant
 * (invalid input, unexpected errors) are always shown.
 */
export function feedbackFor(state: BagActionState, variantId: string | null): BagFeedback | null {
  if (state.variantId && state.variantId !== variantId) return null;
  return bagFeedback(state);
}
