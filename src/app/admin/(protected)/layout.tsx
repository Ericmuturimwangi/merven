import Link from "next/link";
import { Suspense } from "react";
import { SignOutButton } from "@/components/admin/sign-out-button";
import { requireAdmin } from "@/server/auth/session";

async function AdminGate({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <>
      <header className="border-b border-line bg-ivory">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-4 sm:px-6">
          <Link href="/admin" className="font-display text-xl tracking-[0.18em]">
            MERVEN <span className="font-sans text-xs tracking-normal text-stone">admin</span>
          </Link>
          <nav aria-label="Admin" className="flex gap-6 text-sm">
            <Link href="/admin" className="hover:underline">Products</Link>
            <Link href="/admin/products/new" className="hover:underline">New product</Link>
            <Link href="/admin/categories" className="hover:underline">Categories</Link>
            <Link href="/admin/orders" className="hover:underline">Orders</Link>
            <Link href="/" className="hover:underline" target="_blank">View site</Link>
          </nav>
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-xs text-stone sm:inline">{admin.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
    </>
  );
}

export default function ProtectedAdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <Suspense fallback={<p className="p-8 text-sm text-stone">Loading…</p>}>
      <AdminGate>{children}</AdminGate>
    </Suspense>
  );
}
