import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { OrderControls } from "@/components/admin/order-controls";
import { formatKES } from "@/lib/money";
import { idSchema } from "@/lib/validation/catalogue";
import { getAdminOrder } from "@/server/admin/queries";
import { attemptMayStillSucceed } from "@/server/orders/order-service";

export const metadata: Metadata = { title: "Order" };

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 19).replace("T", " ") + " UTC" : "—");

// The admin check and the order read depend on the request (session cookie,
// order id), so they stream inside the page's own boundary: navigating here from
// the orders list shows the placeholder at once instead of blocking.
export default function AdminOrderPage({ params }: PageProps<"/admin/orders/[id]">) {
  return (
    <Suspense fallback={<p className="text-sm text-stone">Loading order…</p>}>
      <AdminOrder params={params} />
    </Suspense>
  );
}

async function AdminOrder({ params }: { params: PageProps<"/admin/orders/[id]">["params"] }) {
  const parsed = idSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const order = await getAdminOrder(parsed.data);
  if (!order) notFound();
  const receipt = order.notifications.find((n) => n.kind === "PAYMENT_RECEIPT");

  return (
    <div className="max-w-3xl space-y-8">
      <Link href="/admin/orders" className="text-sm text-stone hover:text-charcoal">← Orders</Link>
      <div>
        <h1 className="font-mono text-xl">{order.reference}</h1>
        <p className="mt-1 text-sm">
          {order.testMode && <strong className="mr-2">TEST</strong>}
          {order.status === "PENDING_PAYMENT" ? "Awaiting payment" : order.status} · stock {order.stockStatus.toLowerCase().replace("_", " ")}
        </p>
      </div>
      {order.needsAttention && (
        <p className="whitespace-pre-line border-l-2 border-danger bg-ivory px-4 py-3 text-sm text-danger">{order.needsAttention}</p>
      )}
      <OrderControls
        id={order.id}
        // Any attempt that could still have been paid, on any order: a late or second payment is found here too.
        canRecheck={order.payments.some((p) => p.status !== "SUCCESS" && attemptMayStillSucceed(p))} canRetryReceipt={order.status === "PAID" && receipt?.status !== "SENT"} />

      <section className="space-y-1 text-sm">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-stone">Customer</h2>
        <p>{order.customerName}</p>
        <p>{order.customerEmail}</p>
        <p>{order.customerPhone}</p>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-stone">Items</h2>
        <table className="w-full text-left text-sm">
          <tbody>
            {order.items.map((i) => (
              <tr key={i.id} className="border-b border-line">
                <td className="py-2 pr-3">{i.productName} <span className="text-stone">({i.colour}, {i.size}) · {i.sku}</span></td>
                <td className="py-2 pr-3">{i.quantity} × {formatKES(i.unitPriceMinor)}</td>
                <td className="py-2 text-right">{formatKES(i.lineTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-right text-sm font-medium">Total {formatKES(order.totalMinor)} (delivery not included)</p>
      </section>

      <section>
        <h2 className="mb-2 text-xs uppercase tracking-wider text-stone">Payment attempts</h2>
        <ul className="space-y-2 text-sm">
          {order.payments.map((p) => (
            <li key={p.id} className="border border-line bg-ivory p-3">
              <p className="font-mono text-xs">{p.reference}</p>
              <p>{p.status.toLowerCase()} · {formatKES(p.amountMinor)} {p.channel ? `· ${p.channel}` : ""} {p.testMode ? "· test" : ""}</p>
              <p className="text-xs text-stone">Created {when(p.createdAt)} · paid {when(p.paidAt)} · last checked {when(p.lastVerifiedAt)}</p>
              {p.providerTransactionId && <p className="text-xs text-stone">Paystack transaction {p.providerTransactionId}</p>}
              {p.failureReason && <p className="text-xs text-danger">{p.failureReason}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section className="text-sm">
        <h2 className="mb-2 text-xs uppercase tracking-wider text-stone">Receipt email</h2>
        {receipt ? (
          <p>
            {receipt.status.toLowerCase()} · {receipt.attempts} attempt{receipt.attempts === 1 ? "" : "s"}
            {receipt.sentAt && ` · sent ${when(receipt.sentAt)}`}
            {receipt.lastError && <span className="block text-danger">{receipt.lastError}</span>}
          </p>
        ) : (
          <p className="text-stone">No receipt (sent only after a confirmed payment).</p>
        )}
      </section>
    </div>
  );
}
