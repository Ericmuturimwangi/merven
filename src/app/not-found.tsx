import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl flex-1 px-4 py-24 text-center">
      <p className="label text-stone">404</p>
      <h1 className="mt-4 font-display text-4xl">This page isn&rsquo;t here.</h1>
      <Link href="/" className="link-underline mt-8 inline-block text-sm">
        Return home
      </Link>
    </main>
  );
}
