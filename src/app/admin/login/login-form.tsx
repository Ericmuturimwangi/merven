"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { inputClass } from "@/components/admin/form-bits";
import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const data = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      rememberMe: false,
    });
    setPending(false);
    if (error) {
      // Generic message: never reveal whether the email exists.
      setError(error.status === 429 ? "Too many attempts. Please wait a few minutes and try again." : "Incorrect email or password.");
      return;
    }
    router.replace("/admin");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4">
      <div>
        <label htmlFor="email" className="mb-1 block text-xs uppercase tracking-wider text-stone">
          Email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-xs uppercase tracking-wider text-stone">
          Password
        </label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <button type="submit" disabled={pending} className="w-full bg-charcoal py-3 text-sm text-ivory disabled:opacity-50">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
