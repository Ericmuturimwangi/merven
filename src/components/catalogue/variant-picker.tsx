"use client";

import { useMemo, useState } from "react";
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
};

export function VariantPicker({ productName, productUrl, priceFromMinor, priceToMinor, variants, whatsappNumber }: Props) {
  const colours = useMemo(() => {
    const seen = new Map<string, string | null>();
    for (const v of variants) if (!seen.has(v.colour)) seen.set(v.colour, v.colourHex);
    return [...seen.entries()].map(([name, hex]) => ({ name, hex }));
  }, [variants]);

  const [colour, setColour] = useState<string | null>(colours.length === 1 ? colours[0].name : null);
  const [size, setSize] = useState<string | null>(null);

  const sizes = useMemo(() => [...new Set(variants.map((v) => v.size))].sort(compareSizes), [variants]);
  const find = (c: string | null, s: string | null) => variants.find((v) => v.colour === c && v.size === s) ?? null;
  const selected = find(colour, size);
  const colourAvailable = (c: string) => variants.some((v) => v.colour === c && v.available);
  const sizeState = (s: string): "available" | "sold-out" | "unavailable" => {
    const matches = variants.filter((v) => v.size === s && (colour === null || v.colour === colour));
    if (matches.length === 0) return "unavailable";
    return matches.some((v) => v.available) ? "available" : "sold-out";
  };

  const price = selected ? selected.priceMinor : null;
  const href = buildWhatsAppUrl(whatsappNumber, {
    productName,
    productUrl,
    priceMinor: price ?? priceFromMinor,
    size: selected?.size ?? size,
    colour: selected?.colour ?? colour,
    sku: selected?.sku,
  });

  let status: string;
  if (!colour || !size) status = "Choose a colour and size to check availability.";
  else if (!selected) status = `${size} isn't made in ${colour}.`;
  else if (!selected.available) status = `${colour}, size ${size} is sold out. Ask us about restocks.`;
  else if (selected.lowStock) status = `${colour}, size ${size}: only a few left.`;
  else status = `${colour}, size ${size}: in stock.`;

  return (
    <div className="space-y-8">
      <p className="text-xl" aria-live="polite">
        {price !== null ? formatKES(price) : priceFromMinor === priceToMinor ? formatKES(priceFromMinor) : `From ${formatKES(priceFromMinor)}`}
      </p>

      <fieldset>
        <legend className="label mb-3 text-stone">
          Colour{colour && <span className="ml-2 normal-case tracking-normal text-charcoal">{colour}</span>}
        </legend>
        <div className="flex flex-wrap gap-3">
          {colours.map((c) => {
            const on = c.name === colour;
            const avail = colourAvailable(c.name);
            return (
              <button
                key={c.name}
                type="button"
                aria-pressed={on}
                onClick={() => setColour(c.name)}
                className={`flex items-center gap-2 border px-3 py-2 text-sm ${on ? "border-charcoal" : "border-line hover:border-stone"} ${avail ? "" : "text-stone line-through"}`}
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
        <legend className="label mb-3 text-stone">Size</legend>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
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
                className={`border py-3 text-sm disabled:cursor-not-allowed disabled:opacity-30 ${on ? "border-charcoal bg-charcoal text-ivory" : "border-line hover:border-stone"} ${state === "sold-out" && !on ? "text-stone line-through" : ""}`}
              >
                {s}
                {state === "sold-out" && <span className="sr-only"> (sold out)</span>}
              </button>
            );
          })}
        </div>
      </fieldset>

      <p className="text-sm text-ink" aria-live="polite">
        {status}
      </p>

      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-3 bg-charcoal px-6 py-4 text-sm tracking-wide text-ivory transition-colors hover:bg-ink"
      >
        {selected && !selected.available ? "Ask about restock on WhatsApp" : "Enquire on WhatsApp"}
      </a>
      <p className="text-xs text-stone">
        Opens WhatsApp with a message about this piece. Nothing is sent until you press send.
      </p>
    </div>
  );
}
