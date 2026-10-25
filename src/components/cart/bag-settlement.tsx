"use client";

import Link from "next/link";
import { startTransition, useActionState, useEffect, useRef } from "react";
import { settleBagAction, type SettleState } from "@/server/cart/settle-action";

// Runs the server-side settlement once when the server has seen a checkout link
// worth settling. The server re-checks the order's status; this only asks.
// Stays mounted across the re-render that follows, so its notice survives.

export function BagSettlement({ active }: { active: boolean }) {
  const [state, settle] = useActionState(settleBagAction, { settled: false } as SettleState);
  const asked = useRef(false);

  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    startTransition(() => settle());
  }, [active, settle]);

  return (
    <div role="status" aria-live="polite">
      {state.settled && (
        <div className="mb-8 border-l-2 border-forest bg-white px-4 py-3 text-sm leading-relaxed text-ink">
          <p>
            Your payment for order {state.reference} is confirmed, so the pieces you paid for have been removed from your bag.
            {state.kept > 0 && " Anything you added or changed since then is still here."}
          </p>
          <Link href={state.orderPath} className="link-underline mt-1 inline-flex min-h-11 items-center">
            View your order
          </Link>
        </div>
      )}
    </div>
  );
}
