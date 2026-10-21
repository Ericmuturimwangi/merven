"use client";

import { minorToInput } from "@/lib/money";
import { createProductAction, updateProductAction } from "@/server/admin/actions";
import { Field, FormMessage, SubmitButton, inputClass, invalidProps, useAdminForm } from "./form-bits";

type Props = {
  categories: { id: string; name: string }[];
  product?: {
    id: string;
    name: string;
    slug: string;
    description: string;
    details: string | null;
    categoryId: string;
    priceMinor: number;
    featured: boolean;
    slugLocked: boolean;
  };
};

export function ProductForm({ categories, product }: Props) {
  const { state, pending, formProps } = useAdminForm(product ? updateProductAction : createProductAction);
  return (
    <form {...formProps} className="space-y-5">
      {product && <input type="hidden" name="id" value={product.id} />}
      <Field label="Name" name="name" state={state}>
        <input id="name" name="name" required maxLength={120} defaultValue={product?.name} className={inputClass} {...invalidProps(state, "name")} />
      </Field>
      <Field
        label="URL slug"
        name="slug"
        state={state}
        hint={product?.slugLocked ? "Locked because this product has been published." : "Leave blank to generate from the name."}
      >
        <input
          id="slug"
          name="slug"
          maxLength={80}
          defaultValue={product?.slug}
          readOnly={product?.slugLocked}
          className={`${inputClass} ${product?.slugLocked ? "text-stone" : ""}`}
          {...invalidProps(state, "slug")}
        />
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Category" name="categoryId" state={state}>
          <select id="categoryId" name="categoryId" required defaultValue={product?.categoryId ?? ""} className={inputClass} {...invalidProps(state, "categoryId")}>
            <option value="" disabled>
              Choose…
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Price (KES)" name="price" state={state} hint="Variants can override this.">
          <input
            id="price"
            name="price"
            required
            inputMode="decimal"
            defaultValue={product ? minorToInput(product.priceMinor) : ""}
            className={inputClass}
            {...invalidProps(state, "price")}
          />
        </Field>
      </div>
      <Field label="Description" name="description" state={state}>
        <textarea id="description" name="description" required rows={6} maxLength={5000} defaultValue={product?.description} className={inputClass} {...invalidProps(state, "description")} />
      </Field>
      <Field label="Fabric & care" name="details" state={state}>
        <textarea id="details" name="details" rows={3} maxLength={3000} defaultValue={product?.details ?? ""} className={inputClass} {...invalidProps(state, "details")} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="featured" defaultChecked={product?.featured} />
        Feature on the homepage
      </label>
      <div className="flex items-center gap-4">
        <SubmitButton pending={pending}>{pending ? "Saving…" : product ? "Save changes" : "Create draft"}</SubmitButton>
        <FormMessage state={state} />
      </div>
    </form>
  );
}
