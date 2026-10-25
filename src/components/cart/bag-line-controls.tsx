"use client";

import { createContext, useActionState, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { removeFromBagAction, updateBagQuantityAction } from "@/server/cart/actions";
import { initialBagState, type BagActionState } from "@/server/cart/state";

// Quantity and remove controls for one bag line. Every change goes through the
// bag's server actions, which re-check stock and limits; the props here only
// decide which buttons to offer. After a change, the server re-renders the bag
// with the new quantities and prices.

type Announce = (message: string, opts?: { refocus?: boolean }) => void;
const AnnounceContext = createContext<Announce>(() => {});

/**
 * One screen-reader announcement area for the whole bag: a removed line takes
 * its own controls with it, so its result is announced here, and focus moves to
 * the page heading instead of being lost.
 */
export function BagAnnouncer({ headingId, children }: { headingId: string; children: ReactNode }) {
  const [message, setMessage] = useState("");
  const announce = useCallback<Announce>(
    (text, opts) => {
      setMessage(text);
      if (opts?.refocus) document.getElementById(headingId)?.focus();
    },
    [headingId],
  );
  return (
    <AnnounceContext value={announce}>
      <p role="status" aria-live="polite" className="sr-only">
        {message}
      </p>
      {children}
    </AnnounceContext>
  );
}

const stepButton =
  "flex h-11 w-11 items-center justify-center text-lg transition-colors hover:bg-ivory disabled:cursor-not-allowed disabled:text-stone/50 disabled:hover:bg-transparent";
const textButton = "link-underline inline-flex min-h-11 items-center text-sm disabled:cursor-not-allowed disabled:opacity-60";

function updateMessage(state: BagActionState, label: string): string | undefined {
  if (state.outcome === "updated") return `${label}: quantity ${state.quantity}.`;
  return state.message;
}

type Props = {
  variantId: string;
  /** Used in button names, e.g. "Remove Abeni Dress from your bag". */
  label: string;
  quantity: number;
  /** Most this line can hold now; 0 when the piece can't be bought. */
  maxQuantity: number;
  /** Offer to keep the current price, which clears the price-change notice. */
  priceChanged: boolean;
};

export function BagLineControls({ variantId, label, quantity, maxQuantity, priceChanged }: Props) {
  const announce = useContext(AnnounceContext);
  const [updated, update, updating] = useActionState(updateBagQuantityAction, initialBagState);
  const [removed, remove, removing] = useActionState(removeFromBagAction, initialBagState);
  // Acknowledging a new price resubmits the same quantity (recording the price as seen). Its own
  // state keeps its announcement accurate: no quantity changed and nothing was added.
  const [acknowledged, acknowledge, acknowledging] = useActionState(updateBagQuantityAction, initialBagState);
  const busy = updating || removing || acknowledging;
  const buyable = maxQuantity > 0;

  useEffect(() => {
    const text = updateMessage(updated, label);
    if (text) announce(text);
  }, [updated, label, announce]);
  useEffect(() => {
    if (acknowledged.outcome) announce(acknowledged.outcome === "updated" ? `Price change noted for ${label}.` : (acknowledged.message ?? ""));
  }, [acknowledged, label, announce]);
  useEffect(() => {
    if (removed.outcome) announce(removed.ok ? `${label} removed from your bag.` : (removed.message ?? ""), { refocus: removed.ok });
  }, [removed, label, announce]);

  // Shown next to the line when the server changed or refused a quantity.
  const refused = (s: BagActionState) => (s.outcome && s.outcome !== "updated" ? s.message : undefined);
  const note = (!updating && refused(updated)) || (!acknowledging && refused(acknowledged)) || (!removing && !removed.ok ? removed.message : undefined);

  const quantityForm = (to: number, children: ReactNode, opts: { disabled: boolean; ariaLabel?: string; className: string; priceAcknowledgement?: boolean }) => (
    <form action={opts.priceAcknowledgement ? acknowledge : update}>
      <input type="hidden" name="variantId" value={variantId} />
      <input type="hidden" name="quantity" value={to} />
      <button type="submit" disabled={busy || opts.disabled} aria-label={opts.ariaLabel} className={opts.className}>
        {children}
      </button>
    </form>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div role="group" aria-label={`Quantity of ${label}`} className="inline-flex items-center border border-line bg-white">
          {quantityForm(quantity - 1, "−", { disabled: !buyable || quantity <= 1, ariaLabel: `Decrease quantity of ${label}`, className: stepButton })}
          <span className="min-w-8 text-center text-sm tabular-nums">
            <span className="sr-only">Quantity </span>
            {quantity}
          </span>
          {quantityForm(quantity + 1, "+", { disabled: !buyable || quantity >= maxQuantity, ariaLabel: `Increase quantity of ${label}`, className: stepButton })}
        </div>
        {/* Names start with the visible text and say which piece they're for, since several lines can show the same button. */}
        {buyable &&
          quantity > maxQuantity &&
          quantityForm(maxQuantity, `Change to ${maxQuantity}`, { disabled: false, ariaLabel: `Change to ${maxQuantity}: ${label}`, className: textButton })}
        {buyable &&
          priceChanged &&
          quantity <= maxQuantity &&
          quantityForm(quantity, "OK, keep the new price", {
            disabled: false,
            ariaLabel: `OK, keep the new price: ${label}`,
            className: `${textButton} text-stone`,
            priceAcknowledgement: true,
          })}
        <form action={remove}>
          <input type="hidden" name="variantId" value={variantId} />
          <button type="submit" disabled={busy} aria-label={`Remove ${label} from your bag`} className={`${textButton} text-stone hover:text-charcoal`}>
            {removing ? "Removing…" : "Remove"}
          </button>
        </form>
      </div>
      {note && <p className="text-sm text-ink">{note}</p>}
    </div>
  );
}
