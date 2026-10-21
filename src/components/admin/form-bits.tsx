"use client";

import { startTransition, useActionState, useEffect, useRef } from "react";
import { initialActionState, type ActionState } from "@/server/admin/action-state";

type Action = (prev: ActionState, form: FormData) => Promise<ActionState>;

/**
 * Submits a form to a server action without React's automatic form reset, so
 * the admin's input survives validation errors. Optionally resets on success.
 */
export function useAdminForm(action: Action, opts: { resetOnSuccess?: boolean } = {}) {
  const [state, dispatch, pending] = useActionState(action, initialActionState);
  const ref = useRef<HTMLFormElement>(null);
  const { resetOnSuccess } = opts;
  useEffect(() => {
    if (state.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(data));
  }

  return { state, pending, formProps: { ref, onSubmit } };
}

export const inputClass =
  "w-full border border-line bg-paper px-3 py-2 text-sm focus:border-charcoal focus:outline-none aria-[invalid=true]:border-danger";

export function FieldError({ state, name, id }: { state: ActionState; name: string; id?: string }) {
  const msg = state.errors?.[name]?.[0];
  if (!msg) return null;
  return (
    <p id={`${id ?? name}-error`} className="mt-1 text-xs text-danger">
      {msg}
    </p>
  );
}

export function Field({
  label,
  name,
  id,
  state,
  hint,
  children,
}: {
  label: string;
  name: string;
  /** Input id when it differs from the field name (several forms on one page). */
  id?: string;
  state: ActionState;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id ?? name} className="mb-1 block text-xs font-medium uppercase tracking-wider text-stone">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-stone">{hint}</p>}
      <FieldError state={state} name={name} id={id} />
    </div>
  );
}

export function invalidProps(state: ActionState, name: string, id?: string) {
  const bad = Boolean(state.errors?.[name]?.length);
  return { "aria-invalid": bad || undefined, "aria-describedby": bad ? `${id ?? name}-error` : undefined };
}

export function SubmitButton({
  children,
  pending = false,
  variant = "primary",
  className = "",
  name,
  value,
}: {
  children: React.ReactNode;
  pending?: boolean;
  variant?: "primary" | "secondary" | "danger";
  className?: string;
  name?: string;
  value?: string;
}) {
  const styles = {
    primary: "bg-charcoal text-ivory hover:bg-ink",
    secondary: "border border-charcoal hover:bg-ivory-deep",
    danger: "border border-danger text-danger hover:bg-danger hover:text-ivory",
  }[variant];
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`px-4 py-2 text-sm transition-colors disabled:opacity-50 ${styles} ${className}`}
    >
      {children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state.message) return null;
  return (
    <p role="status" className={`text-sm ${state.ok ? "text-success" : "text-danger"}`}>
      {state.message}
    </p>
  );
}
