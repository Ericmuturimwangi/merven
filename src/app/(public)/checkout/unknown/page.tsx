import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Payment", robots: { index: false, follow: false } };

export default function UnknownPaymentPage() {
  return (
    <div className="mx-auto max-w-xl px-4 py-20 text-center">
      <h1 className="font-display text-4xl font-medium">We couldn&rsquo;t find that payment</h1>
      <p className="mt-4 text-ink">
        If you were charged, please contact us on WhatsApp with your Paystack receipt and we&rsquo;ll sort it out. Please
        don&rsquo;t pay again until we&rsquo;ve checked.
      </p>
      <Link href="/" className="link-underline mt-8 inline-block text-sm">Return home</Link>
    </div>
  );
}
