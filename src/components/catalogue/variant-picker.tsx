"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { AddToBag } from "@/components/cart/add-to-bag";
import { formatKES } from "@/lib/money";
import { compareSizes } from "@/lib/sizes";
import { buildWhatsAppUrl } from "@/lib/whatsapp";
import type { PublicVariant } from "@/server/catalogue/repository";

type Props = {
  productName: string;
  productUrl: string;
  priceFromMinor: number;
  priceToMinor: number;
  variants: PublicVariant[];
  whatsappNumber: string;
  /** Rendered between the price and the options (the short description). */
  children?: ReactNode;
  /** Set only when online payment is available (server-side config). */
  onlinePayment?: { testMode: boolean } | null;
};

export function VariantPicker({ productName, productUrl, priceFromMinor, priceToMinor, variants, whatsappNumber, children, onlinePayment }: Props) {
  const colours = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of variants) if (!seen.has(v.colour)) seen.set(v.colour, v.colourHex);
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }));
  }, [variants]);
  const sizes = useMemo(() => [...new Set(variants.map((v) => v.size))].sort(compareSizes), [variants]);

  // A single option needs no decision, so preselect it (e.g. "One size").
  const [colour, setColour] = useState<string | null>(colours.length === 1 ? colours[0].name : null);
  const [size, setSize] = useState<string | null>(sizes.length === 1 ? sizes[0] : null);

  const selected = variants.find((v) => v.colour === colour && v.size === size) ?? null;
  const statusId = useId();
  const colourAvailable = (c: string) => variants.some((v) => v.colour === c && v.available);
  const sizeState = (s: string): "available" | "sold-out" | "unavailable" => {
    const matches = variants.filter((v) => v.size === s && (colour === null || v.colour === colour));
    if (matches.length === 0) return "unavailable";
    return matches.some((v) => v.available) ? "available" : "sold-out";
  };

  const isRange = priceFromMinor !== priceToMinor;
  const href = buildWhatsAppUrl(whatsappNumber, {
    productName,
    productUrl,
    priceMinor: selected?.priceMinor ?? priceFromMinor,
    priceIsFrom: !selected && isRange,
    size,
    colour,
  });

  let status: string;
  if (!colour && !size) status = "Choose a colour and size to check availability.";
  else if (!colour) status = "Choose a colour.";
  else if (!size) status = "Choose a size.";
  else if (!selected) status = `Size ${size} isn't available in ${colour}.`;
  else if (!selected.available) status = `${colour}, size ${size} is sold out. You can still ask us about a restock.`;
  else if (selected.lowStock) status = `${colour}, size ${size}: only a few left.`;
  else status = `${colour}, size ${size}: available.`;

  return (
    <div className="space-y-7">
      <p className="text-lg text-charcoal" aria-live="polite">
        {selected ? formatKES(selected.priceMinor) : isRange ? `From ${formatKES(priceFromMinor)}` : formatKES(priceFromMinor)}
      </p>
      {children}

      <fieldset>
        <legend className="mb-3 text-sm text-stone">
          Colour{colour && <span className="ml-2 text-charcoal">{colour}</span>}
        </legend>
        <div className="flex flex-wrap gap-2">
          {colours.map((c) => {
            const on = c.name === colour;
            const avail = colourAvailable(c.name);
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={on}
                onClick={() => setColour(c.name)}
                className={`flex min-h-11 items-center gap-2 border px-3 text-sm transition-colors ${on ? "border-charcoal bg-white" : "border-line hover:border-stone"} ${avail ? "" : "text-stone line-through"}`}
              >
                {c.hex && <span aria-hidden className="h-4 w-4 rounded-full border border-line" style={{ backgroundColor: c.hex }} />}
                {c.name}
                {!avail && <span className="sr-only">(sold out)</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-3 text-sm text-stone">
          Size{size && <span className="ml-2 text-charcoal">{size}</span>}
        </legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {sizes.map((s) => {
            const state = sizeState(s);
            const on = s === size;
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                disabled={state === "unavailable"}
                onClick={() => setSize(s)}
                className={`min-h-11 border px-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${on ? "border-charcoal bg-charcoal text-white" : "border-line hover:border-stone"} ${state === "sold-out" && !on ? "text-stone line-through" : ""}`}
              >
                {s}
                {state === "sold-out" && <span className="sr-only"> (sold out)</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <p id={statusId} className="text-sm text-ink" aria-live="polite">
        {status}
      </p>

      {/* On phones the bag and enquiry buttons stay reachable while scrolling the options. */}
      <div className="sticky bottom-0 z-10 -mx-4 border-t border-line bg-ivory/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        {/* The server re-checks availability; this only avoids offering a sold-out choice. */}
        <AddToBag variantId={selected?.available ? selected.id : null} describedBy={statusId} />
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 flex min-h-12 w-full items-center justify-center border border-charcoal px-6 text-sm tracking-wide transition-colors hover:bg-white"
        >
          {selected && !selected.available ? "Ask about a restock on WhatsApp" : "Enquire on WhatsApp"}
        </a>
        {onlinePayment && selected?.available && (
          <a
            href={`/checkout?items=${selected.id}:1`}
            className="mt-2 flex min-h-12 w-full items-center justify-center border border-charcoal px-6 text-sm tracking-wide transition-colors hover:bg-white"
          >
            Buy now and pay online{onlinePayment.testMode ? " (test mode)" : ""}
          </a>
        )}
      </div>
      <p className="text-xs leading-relaxed text-stone">
        Opens WhatsApp with this piece, your size and colour already written in. Nothing is sent until you press send. An
        enquiry isn&rsquo;t an order: we&rsquo;ll confirm availability, delivery and payment with you first.
      </p>
    </div>
  );
}
