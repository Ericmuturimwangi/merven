import Image from "next/image";
import Link from "next/link";
import type { PublicProductCard } from "@/server/catalogue/repository";
import { Price } from "./price";

export function ProductCard({ product, priority = false }: { product: PublicProductCard; priority?: boolean }) {
  return (
    <Link href={`/products/${product.slug}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden bg-ivory-deep">
        {product.image && (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            priority={priority}
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover"
          />
        )}
        {product.hoverImage && (
          <Image
            src={product.hoverImage.url}
            alt=""
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-cover opacity-0 transition-opacity duration-500 group-hover:opacity-100"
          />
        )}
        {!product.inStock && (
          <span className="label absolute left-3 top-3 bg-ivory/90 px-2 py-1 text-charcoal">Sold out</span>
        )}
      </div>
      <div className="mt-3 space-y-1">
        <p className="label text-stone">{product.category.name}</p>
        <h3 className="font-display text-lg leading-snug group-hover:underline group-hover:underline-offset-4">
          {product.name}
        </h3>
        <Price from={product.priceFromMinor} to={product.priceToMinor} className="text-sm" />
      </div>
    </Link>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: PublicProductCard[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
