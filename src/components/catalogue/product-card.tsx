import Image from "next/image";
import Link from "next/link";
import { imageFit } from "@/lib/image-fit";
import type { PublicImage, PublicProductCard } from "@/server/catalogue/repository";
import { Price } from "./price";

const SIZES = "(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw";

function CardImage({ img, priority, hover }: { img: PublicImage; priority?: boolean; hover?: boolean }) {
  return (
    <Image
      src={img.url}
      alt={hover ? "" : img.alt}
      fill
      priority={priority}
      sizes={SIZES}
      className={`${imageFit(img.width, img.height) === "cover" ? "object-cover" : "object-contain"} ${hover ? "opacity-0 transition-opacity duration-500 group-hover:opacity-100" : ""}`}
    />
  );
}

export function ProductCard({ product, priority = false }: { product: PublicProductCard; priority?: boolean }) {
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-white">
        {product.image ? <CardImage img={product.image} priority={priority} /> : <div className="absolute inset-0 bg-ivory-deep" />}
        {product.hoverImage && <CardImage img={product.hoverImage} hover />}
        {!product.inStock && <span className="absolute left-3 top-3 bg-ivory px-2 py-1 text-xs text-charcoal">Sold out</span>}
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="font-display text-xl leading-snug group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
          {product.name}
        </h3>
        <Price from={product.priceFromMinor} to={product.priceToMinor} className="text-sm text-ink" />
      </div>
    </Link>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: PublicProductCard[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-10 sm:grid-cols-3 sm:gap-x-5 lg:grid-cols-4 lg:gap-x-6">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
