"use client";

import { minorToInput } from "@/lib/money";
import { addVariantAction, setVariantStockAction, updateVariantAction } from "@/server/admin/actions";
import { Field, FormMessage, SubmitButton, inputClass, invalidProps, useAdminForm } from "./form-bits";

export type AdminVariant = {
  id: string;
  sku: string;
  size: string;
  colour: string;
  colourHex: string | null;
  priceMinor: number | null;
  stock: number;
  active: boolean;
};

function StockForm({ variant }: { variant: AdminVariant }) {
  const { state, pending, formProps } = useAdminForm(setVariantStockAction);
  return (
    <form {...formProps} className="flex items-center gap-2">
      <input type="hidden" name="variantId" value={variant.id} />
      <label className="sr-only" htmlFor={`stock-${variant.id}`}>
        Stock for {variant.colour} {variant.size}
      </label>
      <input
        id={`stock-${variant.id}`}
        name="stock"
        type="number"
        min={0}
        max={100000}
        step={1}
        defaultValue={variant.stock}
        className={`${inputClass} w-20`}
        {...invalidProps(state, "stock")}
      />
      <SubmitButton pending={pending} variant="secondary" className="px-3">
        Set
      </SubmitButton>
      {!state.ok && state.message && <span className="text-xs text-danger">{state.errors?.stock?.[0] ?? state.message}</span>}
    </form>
  );
}

function VariantFields({ state, v }: { state: ReturnType<typeof useAdminForm>["state"]; v?: AdminVariant }) {
  const p = v ? `-${v.id}` : "-new";
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
      <Field label="Size" name="size" id={`size${p}`} state={state}>
        <input id={`size${p}`} name="size" required maxLength={20} defaultValue={v?.size} className={inputClass} {...invalidProps(state, "size", `size${p}`)} />
      </Field>
      <Field label="Colour" name="colour" id={`colour${p}`} state={state}>
        <input id={`colour${p}`} name="colour" required maxLength={40} defaultValue={v?.colour} className={inputClass} {...invalidProps(state, "colour", `colour${p}`)} />
      </Field>
      <Field label="Swatch" name="colourHex" id={`colourHex${p}`} state={state}>
        <input id={`colourHex${p}`} name="colourHex" placeholder="#1f1d1b" defaultValue={v?.colourHex ?? ""} className={inputClass} {...invalidProps(state, "colourHex", `colourHex${p}`)} />
      </Field>
      <Field label="SKU" name="sku" id={`sku${p}`} state={state}>
        <input id={`sku${p}`} name="sku" placeholder="Auto" defaultValue={v?.sku} className={inputClass} {...invalidProps(state, "sku", `sku${p}`)} />
      </Field>
      <Field label="Price override" name="price" id={`price${p}`} state={state}>
        <input id={`price${p}`} name="price" inputMode="decimal" placeholder="—" defaultValue={v?.priceMinor != null ? minorToInput(v.priceMinor) : ""} className={inputClass} {...invalidProps(state, "price", `price${p}`)} />
      </Field>
      <Field label="Stock" name="stock" id={`stock-field${p}`} state={state}>
        <input id={`stock-field${p}`} name="stock" type="number" min={0} step={1} required defaultValue={v?.stock ?? 0} className={inputClass} {...invalidProps(state, "stock", `stock-field${p}`)} />
      </Field>
    </div>
  );
}

function EditVariant({ variant }: { variant: AdminVariant }) {
  const { state, pending, formProps } = useAdminForm(updateVariantAction);
  return (
    <form {...formProps} className="space-y-3 bg-paper p-4">
      <input type="hidden" name="variantId" value={variant.id} />
      <VariantFields state={state} v={variant} />
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" defaultChecked={variant.active} /> Active (shown on the site)
        </label>
        <SubmitButton pending={pending}>Save variant</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

function AddVariant({ productId }: { productId: string }) {
  const { state, pending, formProps } = useAdminForm(addVariantAction, { resetOnSuccess: true });
  return (
    <form {...formProps} className="space-y-3 border border-dashed border-line p-4">
      <p className="text-sm font-medium">Add a size / colour</p>
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="active" value="true" />
      <VariantFields state={state} />
      <div className="flex items-center gap-4">
        <SubmitButton pending={pending}>Add variant</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}

export function VariantManager({ productId, variants }: { productId: string; variants: AdminVariant[] }) {
  return (
    <div className="space-y-6">
      {variants.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-charcoal text-xs uppercase tracking-wider text-stone">
                <th className="py-2 pr-3 font-medium">Colour</th>
                <th className="py-2 pr-3 font-medium">Size</th>
                <th className="py-2 pr-3 font-medium">SKU</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium">Stock</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.id} className="border-b border-line">
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      {v.colourHex && <span aria-hidden className="h-3 w-3 rounded-full border border-line" style={{ backgroundColor: v.colourHex }} />}
                      {v.colour}
                    </span>
                  </td>
                  <td className="py-2 pr-3">{v.size}</td>
                  <td className="py-2 pr-3 font-mono text-xs">{v.sku}</td>
                  <td className="py-2 pr-3">
                    {!v.active ? <span className="text-stone">Hidden</span> : v.stock === 0 ? <span className="text-danger">Sold out</span> : "In stock"}
                  </td>
                  <td className="py-2">
                    <StockForm key={`${v.id}-${v.stock}`} variant={v} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {variants.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm text-stone hover:text-charcoal">Edit variant details</summary>
          <div className="mt-4 space-y-3">
            {variants.map((v) => (
              <EditVariant key={`${v.id}-${v.stock}-${v.active}`} variant={v} />
            ))}
          </div>
        </details>
      )}
      <AddVariant productId={productId} />
    </div>
  );
}
