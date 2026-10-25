import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ImageManager } from "@/components/admin/image-manager";
import { ProductForm } from "@/components/admin/product-form";
import { StatusControls } from "@/components/admin/status-controls";
import { VariantManager } from "@/components/admin/variant-manager";
import { idSchema } from "@/lib/validation/catalogue";
import { getAdminProduct, listAdminCategories } from "@/server/admin/queries";
import { MAX_IMAGES_PER_PRODUCT } from "@/server/images/validate";

export const metadata: Metadata = { title: "Edit product" };

export default async function EditProductPage({ params, searchParams }: PageProps<"/admin/products/[id]">) {
  const { id } = await params;
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) notFound();
  const [product, categories, sp] = await Promise.all([getAdminProduct(parsedId.data), listAdminCategories(), searchParams]);
  if (!product) notFound();

  return (
    <div className="space-y-12">
      <div className="space-y-3">
        <Link href="/admin" className="text-sm text-stone hover:text-charcoal">
          ← Products
        </Link>
        <div className="flex flex-wrap items-baseline justify-between gap-4">
          <h1 className="font-display text-3xl">{product.name}</h1>
          <p className="text-sm">
            Status: <strong className="font-medium">{product.status.toLowerCase()}</strong>
            {product.status === "PUBLISHED" && (
              <>
                {" · "}
                <Link href={`/products/${product.slug}`} target="_blank" className="link-underline">
                  View on site
                </Link>
              </>
            )}
          </p>
        </div>
        {sp.created && <p className="text-sm text-success">Draft created. Add images and sizes, then publish.</p>}
      </div>

      <section aria-labelledby="visibility" className="space-y-4 border border-line bg-ivory p-5">
        <h2 id="visibility" className="text-xs uppercase tracking-wider text-stone">Visibility</h2>
        <StatusControls id={product.id} status={product.status} featured={product.featured} />
      </section>

      <section aria-labelledby="details" className="max-w-2xl space-y-4">
        <h2 id="details" className="font-display text-2xl">Details</h2>
        <ProductForm
          key={product.updatedAt.toISOString()}
          categories={categories.map((c) => ({ id: c.id, name: c.name }))}
          product={{
            id: product.id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            details: product.details,
            categoryId: product.categoryId,
            priceMinor: product.priceMinor,
            featured: product.featured,
            slugLocked: product.publishedAt !== null,
          }}
        />
      </section>

      <section aria-labelledby="variants" className="space-y-4">
        <h2 id="variants" className="font-display text-2xl">Sizes, colours &amp; stock</h2>
        <VariantManager productId={product.id} variants={product.variants} />
      </section>

      <section aria-labelledby="images" className="space-y-4">
        <h2 id="images" className="font-display text-2xl">
          Images <span className="text-base text-stone">({product.images.length}/{MAX_IMAGES_PER_PRODUCT})</span>
        </h2>
        <ImageManager productId={product.id} images={product.images} max={MAX_IMAGES_PER_PRODUCT} colours={[...new Set(product.variants.map((v) => v.colour))]} />
      </section>
    </div>
  );
}
