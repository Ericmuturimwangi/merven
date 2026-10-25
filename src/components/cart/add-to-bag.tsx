"use client";

import Link from "next/link";
import { useActionState } from "react";
import { addToBagAction } from "@/server/cart/actions";
import { initialBagState } from "@/server/cart/state";
import { BAG_PATH } from "./bag-link";
import { feedbackFor, type BagFeedback } from "./bag-feedback";

// Add to bag on the product page. The form sends only the variant id and a
// quantity of 1; the server decides availability, limits and price, and its
// answer is what the customer is told.

const TONE: Record<BagFeedback["tone"], string> = { success: "text-success", notice: "text-ink", error: "text-danger" };

export function BagNotice({ feedback }: { feedback: BagFeedback }) {
  return (
    <div className="space-y-2 pt-3">
      <p className={`text-sm ${TONE[feedback.tone]}`}>{feedback.message}</p>
      {feedback.viewBag && (
        <div className="flex flex-wrap gap-x-6">
          <Link href={BAG_PATH} className="link-underline inline-flex min-h-11 items-center text-sm">
            View bag
          </Link>
          <Link href="/shop" className="link-underline inline-flex min-h-11 items-center text-sm text-stone hover:text-charcoal">
            Continue shopping
          </Link>
        </div>
      )}
    </div>
  );
}

/** `variantId` is the selected variant when it is shown as available, else null (the button is disabled). */
export function AddToBag({ variantId, describedBy }: { variantId: string | null; describedBy?: string }) {
  const [state, action, pending] = useActionState(addToBagAction, initialBagState);
  const feedback = pending ? null : feedbackFor(state, variantId);

  return (
    <div>
      <form action={action}>
        {variantId && <input type="hidden" name="variantId" value={variantId} />}
        <input type="hidden" name="quantity" value="1" />
        <button
          type="submit"
          disabled={!variantId || pending}
          aria-describedby={describedBy}
          className="flex min-h-12 w-full items-center justify-center bg-forest px-6 text-sm tracking-wide text-white transition-colors hover:bg-forest-deep disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-forest"
        >
          {pending ? "Adding…" : "Add to bag"}
        </button>
      </form>
      {/* Always mounted, so screen readers announce each new result. */}
      <div role="status" aria-live="polite">
        {feedback && <BagNotice feedback={feedback} />}
      </div>
    </div>
  );
}
