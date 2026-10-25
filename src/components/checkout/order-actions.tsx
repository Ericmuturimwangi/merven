"use client";

import { useActionState } from "react";
import { checkPaymentAction, retryPaymentAction } from "@/server/checkout/actions";
import { initialCheckoutState } from "@/server/checkout/state";

type Props = { reference: string; token: string };

export function CheckPaymentButton({ reference, token }: Props) {
  const [state, action, pending] = useActionState(checkPaymentAction, initialCheckoutState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className="min-h-11 border border-charcoal px-5 text-sm transition-colors hover:bg-white disabled:opacity-60">
        {pending ? "Checking…" : "Check payment status"}
      </button>
      {state.message && <p role="status" className="text-sm text-ink">{state.message}</p>}
    </form>
  );
}

export function RetryPaymentButton({ reference, token, label = "Try paying again" }: Props & { label?: string }) {
  const [state, action, pending] = useActionState(retryPaymentAction, initialCheckoutState);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="reference" value={reference} />
      <input type="hidden" name="token" value={token} />
      <button type="submit" disabled={pending} className="min-h-11 bg-forest px-5 text-sm text-white transition-colors hover:bg-forest-deep disabled:opacity-60">
        {pending ? "Please wait…" : label}
      </button>
      {state.message && <p role="status" className="text-sm text-ink">{state.message}</p>}
    </form>
  );
}
