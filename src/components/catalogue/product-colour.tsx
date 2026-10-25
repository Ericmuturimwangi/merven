"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

// The colour chosen on a product page, shared by the variant picker (which sets
// it) and the gallery (which shows a photo of that colour).

type ColourState = { colour: string | null; setColour: (colour: string | null) => void };

const ProductColourContext = createContext<ColourState | null>(null);

export function ProductColourProvider({ initial, children }: { initial: string | null; children: ReactNode }) {
  const [colour, setColour] = useState<string | null>(initial);
  return <ProductColourContext.Provider value={{ colour, setColour }}>{children}</ProductColourContext.Provider>;
}

/** The shared colour inside a ProductColourProvider; otherwise local state starting at `initial`. */
export function useProductColour(initial: string | null): ColourState {
  const shared = useContext(ProductColourContext);
  const [colour, setColour] = useState<string | null>(initial);
  return shared ?? { colour, setColour };
}

/** Index of the first photo tagged with this colour, or null when there is none (keep the current photo). */
export function photoIndexForColour(images: { colour: string | null }[], colour: string | null): number | null {
  if (colour === null) return null;
  const i = images.findIndex((img) => img.colour === colour);
  return i === -1 ? null : i;
}
