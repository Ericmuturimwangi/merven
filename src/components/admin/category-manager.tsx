"use client";

import { createCategoryAction, deleteCategoryAction, updateCategoryAction } from "@/server/admin/actions";
import { Field, FormMessage, SubmitButton, inputClass, invalidProps, useAdminForm } from "./form-bits";

type Category = { id: string; name: string; slug: string; description: string | null; sortOrder: number; productCount: number };

function CategoryFields({ state, c }: { state: ReturnType<typeof useAdminForm>["state"]; c?: Category }) {
  const p = c ? c.id : "new";
  return (
    <div className="grid gap-3 sm:grid-cols-4">
      <Field label="Name" name="name" id={`name-${p}`} state={state}>
        <input id={`name-${p}`} name="name" required maxLength={60} defaultValue={c?.name} className={inputClass} {...invalidProps(state, "name", `name-${p}`)} />
      </Field>
      <Field label="Slug" name="slug" id={`slug-${p}`} state={state}>
        <input id={`slug-${p}`} name="slug" placeholder="Auto" maxLength={80} defaultValue={c?.slug} className={inputClass} {...invalidProps(state, "slug", `slug-${p}`)} />
      </Field>
      <Field label="Order" name="sortOrder" id={`sort-${p}`} state={state}>
        <input id={`sort-${p}`} name="sortOrder" type="number" min={0} max={1000} defaultValue={c?.sortOrder ?? 0} className={inputClass} {...invalidProps(state, "sortOrder", `sort-${p}`)} />
      </Field>
      <Field label="Description" name="description" id={`desc-${p}`} state={state}>
        <input id={`desc-${p}`} name="description" maxLength={500} defaultValue={c?.description ?? ""} className={inputClass} {...invalidProps(state, "description", `desc-${p}`)} />
      </Field>
    </div>
  );
}

type DeleteForm = ReturnType<typeof useAdminForm>;

// The delete form state lives in CategoryManager: a successful delete removes
// this row, and the result message must outlive it.
function DeleteCategoryForm({ category, others, del }: { category: Category; others: Category[]; del: DeleteForm }) {
  const n = category.productCount;
  const selectId = `move-${category.id}`;

  if (n > 0 && others.length === 0) {
    return <p className="text-xs text-stone">To delete this category, first create another one to move its {n} products into.</p>;
  }
  return (
    <form
      {...del.formProps}
      onSubmit={(e) => {
        const form = e.currentTarget;
        const select = form.elements.namedItem("moveProductsTo") as HTMLSelectElement | null;
        const target = select?.selectedOptions[0]?.text;
        const question =
          n > 0
            ? `Delete “${category.name}” and move its ${n} product${n === 1 ? "" : "s"} to “${target}”?`
            : `Delete “${category.name}”?`;
        if (!confirm(question)) return e.preventDefault();
        del.formProps.onSubmit(e);
      }}
      className="flex flex-wrap items-end gap-3"
    >
      <input type="hidden" name="id" value={category.id} />
      {n > 0 && (
        <div>
          <label htmlFor={selectId} className="mb-1 block text-xs text-stone">
            Move its {n} product{n === 1 ? "" : "s"} to
          </label>
          <select id={selectId} name="moveProductsTo" required defaultValue="" className={`${inputClass} w-auto`}>
            <option value="" disabled>
              Choose a category…
            </option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <SubmitButton pending={del.pending} variant="danger" className="px-3 py-2 text-xs">
        {n > 0 ? "Move products & delete" : "Delete category"}
      </SubmitButton>
    </form>
  );
}

function CategoryRow({ category, others, del }: { category: Category; others: Category[]; del: DeleteForm }) {
  const save = useAdminForm(updateCategoryAction);
  return (
    <li className="space-y-3 border-b border-line py-5">
      <form {...save.formProps} className="space-y-3">
        <input type="hidden" name="id" value={category.id} />
        <CategoryFields state={save.state} c={category} />
        <div className="flex flex-wrap items-center gap-4">
          <SubmitButton pending={save.pending}>Save</SubmitButton>
          <span className="text-xs text-stone">{category.productCount} products</span>
          <FormMessage state={save.state} />
        </div>
      </form>
      <details>
        <summary className="cursor-pointer text-xs text-stone hover:text-danger">Delete this category…</summary>
        <div className="mt-3">
          <DeleteCategoryForm category={category} others={others} del={del} />
        </div>
      </details>
    </li>
  );
}

export function CategoryManager({ categories }: { categories: Category[] }) {
  const create = useAdminForm(createCategoryAction, { resetOnSuccess: true });
  const del = useAdminForm(deleteCategoryAction);
  return (
    <div className="space-y-10">
      <div aria-live="polite">
        <FormMessage state={del.state} />
      </div>
      <ul>
        {categories.map((c) => (
          <CategoryRow
            key={`${c.id}-${c.name}-${c.slug}-${c.sortOrder}-${c.productCount}`}
            category={c}
            others={categories.filter((o) => o.id !== c.id)}
            del={del}
          />
        ))}
      </ul>
      <form {...create.formProps} className="space-y-3 border border-dashed border-line p-4">
        <p className="text-sm font-medium">New category</p>
        <CategoryFields state={create.state} />
        <div className="flex items-center gap-4">
          <SubmitButton pending={create.pending}>Create category</SubmitButton>
          <FormMessage state={create.state} />
        </div>
      </form>
    </div>
  );
}
