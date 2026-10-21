"use client";

import { setProductFeaturedAction, setProductStatusAction } from "@/server/admin/actions";
import { FormMessage, SubmitButton, useAdminForm } from "./form-bits";

type Status = "DRAFT" | "PUBLISHED" | "ARCHIVED";

export function StatusControls({ id, status, featured }: { id: string; status: Status; featured: boolean }) {
  const statusForm = useAdminForm(setProductStatusAction);
  const featuredForm = useAdminForm(setProductFeaturedAction);
  return (
    <div className="space-y-4">
      <form {...statusForm.formProps} className="flex flex-wrap gap-2">
        <input type="hidden" name="id" value={id} />
        {status !== "PUBLISHED" && (
          <SubmitButton pending={statusForm.pending} name="status" value="PUBLISHED">
            Publish
          </SubmitButton>
        )}
        {status !== "DRAFT" && (
          <SubmitButton pending={statusForm.pending} name="status" value="DRAFT" variant="secondary">
            {status === "PUBLISHED" ? "Unpublish (draft)" : "Restore to draft"}
          </SubmitButton>
        )}
        {status !== "ARCHIVED" && (
          <SubmitButton pending={statusForm.pending} name="status" value="ARCHIVED" variant="danger">
            Archive
          </SubmitButton>
        )}
      </form>
      <FormMessage state={statusForm.state} />
      {status !== "ARCHIVED" && (
        <form {...featuredForm.formProps}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="featured" value={featured ? "false" : "true"} />
          <SubmitButton pending={featuredForm.pending} variant="secondary">
            {featured ? "Remove from homepage" : "Feature on homepage"}
          </SubmitButton>
          <div className="mt-2">
            <FormMessage state={featuredForm.state} />
          </div>
        </form>
      )}
    </div>
  );
}
