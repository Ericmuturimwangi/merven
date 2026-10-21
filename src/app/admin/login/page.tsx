import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <p className="font-display text-3xl tracking-[0.18em]">MERVEN</p>
        <h1 className="mt-2 text-sm text-stone">Administrator sign-in</h1>
        <LoginForm />
      </div>
    </main>
  );
}
