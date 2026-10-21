import type { FieldErrors } from "@/lib/validation/catalogue";

export type ActionState = {
  ok: boolean;
  message?: string;
  errors?: FieldErrors;
};

export const initialActionState: ActionState = { ok: false };
