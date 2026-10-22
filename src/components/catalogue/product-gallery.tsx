"use client";

import Image from "next/image";
import { useState } from "react";
import type { PublicImage } from "@/server/catalogue/repository";

// The product page shows every photo whole, at its own proportions: no cropping
// (which could misrepresent length or fit) and no letterboxing.
export function ProductGallery({ images, name }: { images: PublicImage[]; name: string }) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return <div className="aspect-[4/5] bg-ivory-deep" role="img" aria-label={`No photos of ${name} yet`} />;
  const current = images[Math.min(active, images.length - 1)];

  return (
    <div className="lg:flex lg:flex-row-reverse lg:items-start lg:gap-4">
      {/* Phones and tablets: a swipeable strip. A single photo takes the full width. */}
      <ul
        className={`flex snap-x snap-mandatory items-start gap-2 overflow-x-auto lg:hidden ${images.length > 1 ? "-mx-4 px-4 sm:-mx-6 sm:px-6" : ""}`}
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
              sizes="(min-width: 640px) 60vw, 85vw"
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
          sizes="(min-width: 1280px) 45vw, 50vw"
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
