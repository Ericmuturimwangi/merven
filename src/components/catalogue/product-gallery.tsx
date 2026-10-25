"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { PublicProductImage } from "@/server/catalogue/repository";
import { photoIndexForColour, useProductColour } from "./product-colour";

// The product page shows every photo whole, at its own proportions: no cropping
// (which could misrepresent length or fit) and no letterboxing.
// One `sizes` for the phone strip and the desktop view, so the browser picks the
// same file for both and downloads the first photo only once.
const GALLERY_SIZES = "(min-width: 1024px) 50vw, (min-width: 640px) 60vw, 85vw";

export function ProductGallery({ images, name }: { images: PublicProductImage[]; name: string }) {
  // Choosing a colour in the variant picker shows the first photo tagged with it
  // (if any); otherwise the current photo stays. Photos can still be browsed freely.
  const { colour } = useProductColour(null);
  const [active, setActive] = useState(() => photoIndexForColour(images, colour) ?? 0);
  const [shownColour, setShownColour] = useState(colour);
  if (colour !== shownColour) {
    setShownColour(colour);
    const match = photoIndexForColour(images, colour);
    if (match !== null) setActive(match);
  }

  // Phones: bring that photo into view in the swipe strip (horizontally only, never moving the page).
  const strip = useRef<HTMLUListElement>(null);
  const scrolledFor = useRef(colour);
  useEffect(() => {
    if (colour === scrolledFor.current) return;
    scrolledFor.current = colour;
    const match = photoIndexForColour(images, colour);
    const list = strip.current;
    const item = match === null ? null : (list?.children[match] as HTMLElement | undefined);
    if (!list || !item) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    list.scrollTo({ left: item.offsetLeft - (list.clientWidth - item.clientWidth) / 2, behavior: reduceMotion ? "auto" : "smooth" });
  }, [colour, images]);

  if (images.length === 0) return <div className="aspect-[4/5] bg-ivory-deep" role="img" aria-label={`No photos of ${name} yet`} />;
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="lg:flex lg:flex-row-reverse lg:items-start lg:gap-4">
      {/* Phones and tablets: a swipeable strip. A single photo takes the full width. */}
      <ul
        ref={strip}
        className={`relative flex snap-x snap-mandatory items-start gap-2 overflow-x-auto lg:hidden ${images.length > 1 ? "-mx-4 px-4 sm:-mx-6 sm:px-6" : ""}`}
        aria-label={`Photos of ${name}`}
      >
        {images.map((img, i) => (
          <li key={img.url} className={`shrink-0 snap-center ${images.length > 1 ? "w-[85%] sm:w-[60%]" : "w-full"}`}>
            <Image
              src={img.url}
              alt={img.alt}
              width={img.width}
              height={img.height}
              priority={i === 0}
              sizes={GALLERY_SIZES}
              className="h-auto w-full bg-white"
            />
          </li>
        ))}
      </ul>

      {/* Desktop: one large photo with thumbnails. */}
      <div className="hidden flex-1 lg:block">
        <Image
          key={current.url}
          src={current.url}
          alt={current.alt}
          width={current.width}
          height={current.height}
          priority
          sizes={GALLERY_SIZES}
          className="h-auto max-h-[85vh] w-full bg-white object-contain"
        />
      </div>
      {images.length > 1 && (
        <ul className="hidden w-20 shrink-0 flex-col gap-3 lg:flex" aria-label="Choose photo">
          {images.map((img, i) => (
            <li key={img.url}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1} of ${images.length}`}
                aria-current={i === active ? "true" : undefined}
                className={`relative block aspect-[4/5] w-full bg-white ${i === active ? "outline outline-1 outline-offset-2 outline-charcoal" : "opacity-70 hover:opacity-100"}`}
              >
                <Image src={img.url} alt="" fill sizes="80px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
