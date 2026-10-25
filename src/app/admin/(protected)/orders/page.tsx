import type { Metadata } from "next";
import Link from "next/link";
import { RecoverPaymentsControl } from "@/components/admin/order-controls";
import { formatKES } from "@/lib/money";
import { listAdminOrders } from "@/server/admin/queries";

export const metadata: Metadata = { title: "Orders" };
// The recovery action makes up to 10 sequential Paystack calls.
export const maxDuration = 120;

const STATUS_STYLE = { PAID: "text-success", PENDING_PAYMENT: "text-stone", CANCELLED: "text-danger" } as const;

export default async function AdminOrdersPage({ searchParams }: PageProps<"/admin/orders">) {
  const sp = await searchParams;
  const status = sp.status === "paid" ? "PAID" : sp.status === "pending" ? "PENDING_PAYMENT" : undefined;
  const orders = await listAdminOrders({ status, attention: sp.attention === "1" });
  const filters = [
    ["All", "/admin/orders"],
    ["Paid", "/admin/orders?status=paid"],
    ["Awaiting payment", "/admin/orders?status=pending"],
    ["Needs attention", "/admin/orders?attention=1"],
  ];
  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl">Orders</h1>
      <p className="text-sm text-stone">Online orders paid (or started) through Paystack. WhatsApp enquiries are not listed here.</p>
      <RecoverPaymentsControl />
      <nav aria-label="Filter orders" className="flex flex-wrap gap-4 text-sm">
        {filters.map(([label, href]) => (
          <Link key={href} href={href} className="hover:underline">{label}</Link>
        ))}
      </nav>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-charcoal text-xs uppercase tracking-wider text-stone">
              <th className="py-2 pr-3 font-medium">Order</th>
              <th className="py-2 pr-3 font-medium">Customer</th>
              <th className="py-2 pr-3 font-medium">Total</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Receipt</th>
              <th className="py-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id} className="border-b border-line align-top">
                <td className="py-3 pr-3">
                  <Link href={`/admin/orders/${o.id}`} className="font-mono text-xs hover:underline">{o.reference}</Link>
                  {o.testMode && <span className="ml-2 bg-champagne/40 px-1.5 text-xs">test</span>}
                  {o.needsAttention && <p className="mt-1 text-xs text-danger">Needs attention</p>}
                </td>
                <td className="py-3 pr-3">{o.customerName}</td>
                <td className="py-3 pr-3">{formatKES(o.totalMinor)}</td>
                <td className={`py-3 pr-3 ${STATUS_STYLE[o.status]}`}>
                  {o.status === "PENDING_PAYMENT" ? "awaiting payment" : o.status.toLowerCase()}
                  {o.stockStatus === "SHORTFALL" && <span className="block text-xs text-danger">stock shortfall</span>}
                </td>
                <td className="py-3 pr-3 text-stone">{o.notifications[0]?.status.toLowerCase() ?? "—"}</td>
                <td className="py-3 text-stone">{o.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {orders.length === 0 && <p className="py-8 text-center text-sm text-stone">No orders.</p>}
      </div>
    </div>
  );
}
