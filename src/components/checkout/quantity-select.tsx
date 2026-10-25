"use client";

import { useRouter } from "next/navigation";

// Changing a quantity reloads the review with server-side prices and stock.
export function QuantitySelect({ variantId, quantity, max, basket }: { variantId: string; quantity: number; max: number; basket: { variantId: string; quantity: number }[] }) {
  const router = useRouter();
  const id = `qty-${variantId}`;
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className="text-sm text-stone">Qty</label>
      <select
        id={id}
        value={quantity}
        onChange={(e) => {
          const next = basket.map((i) => (i.variantId === variantId ? { ...i, quantity: Number(e.target.value) } : i));
          router.replace(`/checkout?items=${next.map((i) => `${i.variantId}:${i.quantity}`).join(",")}`, { scroll: false });
        }}
        className="min-h-10 border border-line bg-white px-2 text-sm"
      >
        {Array.from({ length: Math.max(max, quantity) }, (_, i) => i + 1).map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </span>
  );
}
