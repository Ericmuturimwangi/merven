import type { PrismaClient } from "@/generated/prisma/client";
import { orderAccessToken } from "../orders/access";
import { MailerError, type Mailer } from "./mailer";
import { renderReceipt } from "./receipt";

// Receipt outbox processor. A receipt row is created in the same transaction
// that marks an order PAID; this sends it later, independently of payment
// state. Runs right after the payment response (next/server `after`) and from a
// protected cron route as a safety net. Sending never happens inside a database
// transaction, and a send failure never touches the order or payment.

export const MAX_RECEIPT_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const STALE_LOCK_MS = 10 * 60_000;

export type ProcessSummary = { claimed: number; sent: number; failed: number; skipped: string | null };

export async function processReceipts(
  prisma: PrismaClient,
  mailer: Mailer | null,
  opts: { siteUrl: string; limit?: number; orderId?: string; now?: () => Date } ,
): Promise<ProcessSummary> {
  const now = opts.now ?? (() => new Date());
  if (!mailer) return { claimed: 0, sent: 0, failed: 0, skipped: "Email provider not configured" };

  const due = await prisma.emailNotification.findMany({
    where: {
      kind: "PAYMENT_RECEIPT",
      ...(opts.orderId ? { orderId: opts.orderId } : {}),
      OR: [
        { status: "PENDING", nextAttemptAt: { lte: now() } },
        { status: "SENDING", lockedAt: { lt: new Date(now().getTime() - STALE_LOCK_MS) } }, // crashed mid-send
      ],
      attempts: { lt: MAX_RECEIPT_ATTEMPTS },
      order: { status: "PAID" }, // never send a receipt for an unpaid order
    },
    orderBy: { nextAttemptAt: "asc" },
    take: opts.limit ?? 10,
    select: { id: true, status: true, attempts: true, lockedAt: true },
  });

  const summary: ProcessSummary = { claimed: 0, sent: 0, failed: 0, skipped: null };
  for (const n of due) {
    // Claim atomically: only one worker wins a given notification.
    const claimed = await prisma.emailNotification.updateMany({
      where: { id: n.id, status: n.status, attempts: n.attempts, lockedAt: n.lockedAt },
      data: { status: "SENDING", lockedAt: now(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    summary.claimed++;

    const note = await prisma.emailNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: {
        attempts: true,
        order: {
          select: {
            reference: true,
            testMode: true,
            customerName: true,
            customerEmail: true,
            createdAt: true,
            paidAt: true,
            currency: true,
            subtotalMinor: true,
            totalMinor: true,
            items: { select: { productName: true, size: true, colour: true, quantity: true, unitPriceMinor: true, lineTotalMinor: true } },
            payments: { where: { status: "SUCCESS" }, orderBy: { paidAt: "asc" }, take: 1, select: { reference: true, channel: true } },
          },
        },
      },
    });
    const o = note.order;
    try {
      if (!o.paidAt || !o.payments[0]) throw new MailerError("Order has no confirmed payment", false);
      const email = renderReceipt({
        reference: o.reference,
        testMode: o.testMode,
        customerName: o.customerName,
        createdAt: o.createdAt,
        paidAt: o.paidAt,
        currency: o.currency,
        subtotalMinor: o.subtotalMinor,
        totalMinor: o.totalMinor,
        payment: o.payments[0],
        items: o.items,
        orderUrl: `${opts.siteUrl}/checkout/order/${o.reference}?token=${orderAccessToken(o.reference)}`,
      });
      const res = await mailer.send({ to: o.customerEmail, ...email, idempotencyKey: `receipt-${n.id}` });
      await prisma.emailNotification.update({
        where: { id: n.id },
        data: { status: "SENT", sentAt: now(), lockedAt: null, providerMessageId: res.messageId, lastError: null },
      });
      summary.sent++;
    } catch (e) {
      const retryable = !(e instanceof MailerError) || e.retryable;
      const exhausted = !retryable || note.attempts >= MAX_RECEIPT_ATTEMPTS;
      await prisma.emailNotification.update({
        where: { id: n.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          lockedAt: null,
          lastError: (e instanceof Error ? e.message : "Unknown error").slice(0, 300),
          nextAttemptAt: new Date(now().getTime() + BACKOFF_MS[Math.min(note.attempts - 1, BACKOFF_MS.length - 1)]),
        },
      });
      summary.failed++;
      console.warn(JSON.stringify({ level: "warn", event: "receipt_send_failed", order: o.reference, attempt: note.attempts, exhausted }));
    }
  }
  return summary;
}

/** Admin: put a failed receipt back in the queue (attempt counter restarts). */
export async function requeueReceipt(prisma: PrismaClient, orderId: string) {
  return prisma.emailNotification.updateMany({
    where: { orderId, kind: "PAYMENT_RECEIPT", status: { in: ["FAILED", "PENDING"] }, order: { status: "PAID" } },
    data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null },
  });
}
