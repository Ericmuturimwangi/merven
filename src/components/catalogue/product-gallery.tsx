"use client";

import Image from "next/image";
import { useState } from "react";
import type { PublicImage } from "@/server/catalogue/repository";

export function ProductGallery({ images, name }: { images: PublicImage[]; name: string }) {
  const [active, setActive] = useState(0);
  if (images.length === 0) return <div className="aspect-[4/5] bg-ivory-deep" aria-label={`No photos of ${name} yet`} />;

  return (
    <div className="lg:flex lg:flex-row-reverse lg:gap-4">
      {/* Mobile: swipeable strip. Desktop: single large image with thumbnails. */}
      <ul
        className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 sm:-mx-6 sm:px-6 lg:hidden"
        aria-label={`Photos of ${name}`}
      >
        {images.map((img, i) => (
          <li key={img.url} className="relative aspect-[4/5] w-[85%] shrink-0 snap-center bg-ivory-deep sm:w-[60%]">
            <Image src={img.url} alt={img.alt} fill priority={i === 0} sizes="(min-width: 640px) 60vw, 85vw" className="object-cover" />
          </li>
        ))}
      </ul>

      <div className="relative hidden aspect-[4/5] flex-1 bg-ivory-deep lg:block">
        <Image
          src={images[active].url}
          alt={images[active].alt}
          fill
          priority
          sizes="(min-width: 1280px) 45vw, 50vw"
          className="object-cover"
        />
      </div>
      {images.length > 1 && (
        <ul className="hidden w-20 shrink-0 flex-col gap-3 lg:flex" aria-label="Choose photo">
          {images.map((img, i) => (
            <li key={img.url}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`Show photo ${i + 1}: ${img.alt}`}
                aria-current={i === active ? "true" : undefined}
                className={`relative block aspect-[4/5] w-full bg-ivory-deep ${i === active ? "outline outline-1 outline-offset-2 outline-charcoal" : "opacity-70 hover:opacity-100"}`}
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
