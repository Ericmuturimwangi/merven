import { formatKES } from "@/lib/money";

// Branded receipt for a CONFIRMED payment. Built only from stored order data.

export type ReceiptData = {
  reference: string;
  testMode: boolean;
  customerName: string;
  createdAt: Date;
  paidAt: Date;
  currency: string;
  subtotalMinor: number;
  totalMinor: number;
  payment: { reference: string; channel: string | null };
  items: { productName: string; size: string; colour: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }[];
  orderUrl: string;
};

const CHANNEL_LABEL: Record<string, string> = { card: "Card", mobile_money: "M-PESA (mobile money)" };

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function date(d: Date) {
  return new Intl.DateTimeFormat("en-KE", { dateStyle: "long", timeStyle: "short", timeZone: "Africa/Nairobi" }).format(d);
}

export const DELIVERY_NOTE =
  "Delivery is not included in this payment and has not been arranged yet. We'll contact you on WhatsApp to agree delivery and any delivery fee.";

export function renderReceipt(r: ReceiptData): { subject: string; html: string; text: string } {
  const test = r.testMode ? "[TEST] " : "";
  const subject = `${test}Your Merven Fashions receipt — order ${r.reference}`;
  const method = r.payment.channel ? (CHANNEL_LABEL[r.payment.channel] ?? r.payment.channel) : null;

  const textLines = [
    r.testMode ? "TEST MODE: no real money was taken. This is not a real purchase.\n" : "",
    `Hello ${r.customerName},`,
    "",
    "Thank you. Your payment has been confirmed.",
    "",
    `Order: ${r.reference}`,
    `Transaction reference: ${r.payment.reference}`,
    `Order date: ${date(r.createdAt)}`,
    `Payment confirmed: ${date(r.paidAt)}`,
    method ? `Payment method: ${method}` : "",
    "",
    ...r.items.map((i) => `${i.quantity} × ${i.productName} (${i.colour}, ${i.size}) @ ${formatKES(i.unitPriceMinor)} = ${formatKES(i.lineTotalMinor)}`),
    "",
    `Subtotal: ${formatKES(r.subtotalMinor)}`,
    `Amount paid: ${formatKES(r.totalMinor)} (${r.currency})`,
    "",
    DELIVERY_NOTE,
    "",
    `View your order: ${r.orderUrl}`,
    "",
    "Merven Fashions",
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "");

  const rows = r.items
    .map(
      (i) => `<tr>
  <td style="padding:10px 0;border-bottom:1px solid #ddd6c8">${esc(i.productName)}<br><span style="color:#66625a;font-size:13px">${esc(i.colour)}, ${esc(i.size)} · ${i.quantity} × ${esc(formatKES(i.unitPriceMinor))}</span></td>
  <td style="padding:10px 0;border-bottom:1px solid #ddd6c8;text-align:right;white-space:nowrap">${esc(formatKES(i.lineTotalMinor))}</td>
</tr>`,
    )
    .join("");

  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f3efe6;color:#282821;font-family:Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:32px 20px">
  ${r.testMode ? `<p style="background:#fff3cd;border:1px solid #d2b786;padding:10px;font-size:13px">TEST MODE: no real money was taken. This is not a real purchase.</p>` : ""}
  <p style="font-family:Georgia,serif;font-size:28px;letter-spacing:6px;margin:0">MERVEN</p>
  <p style="font-size:11px;letter-spacing:4px;color:#66625a;margin:2px 0 28px">FASHIONS</p>
  <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 8px">Payment receipt</h1>
  <p style="margin:0 0 20px">Hello ${esc(r.customerName)}, thank you. Your payment has been confirmed.</p>
  <table style="width:100%;font-size:14px;border-collapse:collapse;margin-bottom:20px" role="presentation">
    <tr><td style="color:#66625a;padding:3px 0">Order</td><td style="text-align:right">${esc(r.reference)}</td></tr>
    <tr><td style="color:#66625a;padding:3px 0">Transaction reference</td><td style="text-align:right">${esc(r.payment.reference)}</td></tr>
    <tr><td style="color:#66625a;padding:3px 0">Order date</td><td style="text-align:right">${esc(date(r.createdAt))}</td></tr>
    <tr><td style="color:#66625a;padding:3px 0">Payment confirmed</td><td style="text-align:right">${esc(date(r.paidAt))}</td></tr>
    ${method ? `<tr><td style="color:#66625a;padding:3px 0">Payment method</td><td style="text-align:right">${esc(method)}</td></tr>` : ""}
  </table>
  <table style="width:100%;font-size:14px;border-collapse:collapse" role="presentation">${rows}
    <tr><td style="padding:12px 0 4px">Subtotal</td><td style="padding:12px 0 4px;text-align:right">${esc(formatKES(r.subtotalMinor))}</td></tr>
    <tr><td style="padding:4px 0;font-weight:bold">Amount paid (${esc(r.currency)})</td><td style="padding:4px 0;text-align:right;font-weight:bold">${esc(formatKES(r.totalMinor))}</td></tr>
  </table>
  <p style="margin:24px 0;padding:12px;background:#ffffff;border-left:3px solid #183c30;font-size:14px">${esc(DELIVERY_NOTE)}</p>
  <p><a href="${esc(r.orderUrl)}" style="color:#183c30">View your order</a></p>
  <p style="color:#66625a;font-size:12px;margin-top:32px">Merven Fashions · Kenya</p>
</div></body></html>`;

  return { subject, html, text: textLines.join("\n") };
}
