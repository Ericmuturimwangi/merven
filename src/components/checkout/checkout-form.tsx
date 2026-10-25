"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { formatKES } from "@/lib/money";
import { startCheckoutAction } from "@/server/checkout/actions";
import { initialCheckoutState } from "@/server/checkout/state";

const input =
  "w-full border border-line bg-white px-3 py-3 text-base focus:border-charcoal focus:outline-none aria-[invalid=true]:border-danger";

function FieldError({ messages, id }: { messages?: string[]; id: string }) {
  return messages?.[0] ? (
    <p id={id} className="mt-1 text-sm text-danger">
      {messages[0]}
    </p>
  ) : null;
}

/** `source="bag"` marks a checkout of the visitor's bag (the server checks it against the bag cookie). */
export function CheckoutForm({ items, totalMinor, testMode, source }: { items: string; totalMinor: number; testMode: boolean; source?: "bag" }) {
  const [state, action, pending] = useActionState(startCheckoutAction, initialCheckoutState);
  const router = useRouter();
  // Prices or availability changed on the server: reload the review with fresh data.
  useEffect(() => {
    if (state.reviewAgain) router.refresh();
  }, [state, router]);
  const e = state.errors ?? {};
  const v = state.values;

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="items" value={items} />
      <input type="hidden" name="expectedTotalMinor" value={totalMinor} />
      {source && <input type="hidden" name="source" value={source} />}
      <div>
        <label htmlFor="name" className="mb-1 block text-sm">Full name</label>
        <input id="name" name="name" defaultValue={v?.name} autoComplete="name" required maxLength={80} className={input} aria-invalid={!!e.name || undefined} aria-describedby={e.name ? "name-error" : undefined} />
        <FieldError messages={e.name} id="name-error" />
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm">Email</label>
        <input id="email" name="email" type="email" defaultValue={v?.email} autoComplete="email" required maxLength={254} className={input} aria-invalid={!!e.email || undefined} aria-describedby={e.email ? "email-error" : "email-hint"} />
        <p id="email-hint" className="mt-1 text-xs text-stone">Your receipt is sent here.</p>
        <FieldError messages={e.email} id="email-error" />
      </div>
      <div>
        <label htmlFor="phone" className="mb-1 block text-sm">Mobile number</label>
        <input id="phone" name="phone" type="tel" defaultValue={v?.phone} inputMode="tel" autoComplete="tel" required placeholder="0712 345 678" className={input} aria-invalid={!!e.phone || undefined} aria-describedby={e.phone ? "phone-error" : "phone-hint"} />
        <p id="phone-hint" className="mt-1 text-xs text-stone">A Kenyan mobile number, so we can arrange delivery with you.</p>
        <FieldError messages={e.phone} id="phone-error" />
      </div>
      {state.message && (
        <p role="alert" className="border-l-2 border-danger bg-white px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="flex min-h-12 w-full items-center justify-center bg-forest px-6 text-sm tracking-wide text-white transition-colors hover:bg-forest-deep disabled:opacity-60"
      >
        {pending ? "Starting secure payment…" : `Pay ${formatKES(totalMinor)}${testMode ? " (test mode)" : ""}`}
      </button>
      <p className="text-xs leading-relaxed text-stone">
        You&rsquo;ll be taken to Paystack to pay by card or M-PESA. Your order is confirmed only once Paystack confirms the payment.
      </p>
    </form>
  );
}
