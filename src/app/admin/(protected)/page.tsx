import Image from "next/image";
import Link from "next/link";
import type { ProductStatus } from "@/generated/prisma/enums";
import { formatKES } from "@/lib/money";
import { getAdminStats, listAdminProducts } from "@/server/admin/queries";

const STATUSES: ProductStatus[] = ["PUBLISHED", "DRAFT", "ARCHIVED"];
const STATUS_STYLE: Record<ProductStatus, string> = {
  PUBLISHED: "text-success",
  DRAFT: "text-stone",
  ARCHIVED: "text-danger",
};

export default async function AdminProductsPage({ searchParams }: PageProps<"/admin">) {
  const sp = await searchParams;
  const statusParam = typeof sp.status === "string" ? sp.status.toUpperCase() : "";
  const status = STATUSES.includes(statusParam as ProductStatus) ? (statusParam as ProductStatus) : undefined;
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 80) : "";
  const [products, stats] = await Promise.all([listAdminProducts({ status, q }), getAdminStats()]);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl">Products</h1>
        <Link href="/admin/products/new" className="bg-charcoal px-4 py-2 text-sm text-ivory">
          New product
        </Link>
      </div>

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          ["Published", stats.published],
          ["Drafts", stats.draft],
          ["Archived", stats.archived],
          ["Sold-out variants", stats.outOfStock],
        ].map(([label, value]) => (
          <div key={label} className="border border-line bg-ivory p-4">
            <dt className="text-xs uppercase tracking-wider text-stone">{label}</dt>
            <dd className="mt-1 font-display text-2xl">{value}</dd>
          </div>
        ))}
      </dl>

      <form className="flex flex-wrap items-center gap-3 text-sm" role="search">
        <input name="q" defaultValue={q} placeholder="Search by name" className="border border-line bg-paper px-3 py-2" />
        <select name="status" defaultValue={status ?? ""} className="border border-line bg-paper px-3 py-2">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s.toLowerCase()}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
        <button className="border border-charcoal px-3 py-2">Filter</button>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead>
            <tr className="border-b border-charcoal text-xs uppercase tracking-wider text-stone">
              <th className="py-2 pr-3 font-medium">Product</th>
              <th className="py-2 pr-3 font-medium">Category</th>
              <th className="py-2 pr-3 font-medium">Price</th>
              <th className="py-2 pr-3 font-medium">Stock</th>
              <th className="py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const stock = p.variants.reduce((n, v) => n + v.stock, 0);
              return (
                <tr key={p.id} className="border-b border-line">
                  <td className="py-3 pr-3">
                    <Link href={`/admin/products/${p.id}`} className="flex items-center gap-3 hover:underline">
                      <span className="relative h-12 w-10 shrink-0 bg-ivory-deep">
                        {p.images[0] && <Image src={p.images[0].url} alt="" fill sizes="40px" className="object-cover" />}
                      </span>
                      <span>
                        {p.name}
                        {p.featured && <span className="ml-2 text-xs text-oxblood">Featured</span>}
                      </span>
                    </Link>
                  </td>
                  <td className="py-3 pr-3 text-stone">{p.category.name}</td>
                  <td className="py-3 pr-3">{formatKES(p.priceMinor)}</td>
                  <td className={`py-3 pr-3 ${stock === 0 ? "text-danger" : ""}`}>{stock}</td>
                  <td className={`py-3 ${STATUS_STYLE[p.status]}`}>{p.status.toLowerCase()}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {products.length === 0 && <p className="py-8 text-center text-sm text-stone">No products match.</p>}
      </div>
    </div>
  );
}
