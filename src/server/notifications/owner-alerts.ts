import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { formatKES } from "@/lib/money";
import { MailerError, type Mailer } from "./mailer";

// Owner alerts for orders that need a person: a possible duplicate payment, a
// stock shortfall, a refund or a dispute reported by Paystack. They use the
// same outbox table as receipts (email_notification), one row per order and
// alert key (kind plus optional detail, see alertKey), so however many
// callbacks or webhooks report the same problem, the owner is alerted once,
// while a genuinely new problem (another attempt, a new dispute stage) is
// alerted again. Sending is separate from payment processing and
// never changes an order or payment.
//
// The alert names the order and the problem and links to the admin page; it
// never includes the customer's name, email or phone number.
//
//   OWNER_ALERT_EMAIL   where alerts go (unset: alerts stay queued, visible in the database)

export const ALERT_KINDS = {
  duplicatePayment: "ALERT_DUPLICATE_PAYMENT",
  stockShortfall: "ALERT_STOCK_SHORTFALL",
  refund: "ALERT_REFUND",
  dispute: "ALERT_DISPUTE",
  /** Paystack's verified transaction differs from the attempt (amount, currency, environment, reference). */
  paymentMismatch: "ALERT_PAYMENT_MISMATCH",
  /** Paystack reports a success whose transaction id is already linked to another attempt. */
  transactionConflict: "ALERT_TRANSACTION_CONFLICT",
  /** A verified successful payment on an order that was no longer awaiting payment. */
  unexpectedPayment: "ALERT_UNEXPECTED_PAYMENT",
  /** A payment we recorded as successful is now reported failed, abandoned or reversed. */
  paymentReversed: "ALERT_PAYMENT_REVERSED",
} as const;
export type AlertKind = (typeof ALERT_KINDS)[keyof typeof ALERT_KINDS];

const TITLES: Record<AlertKind, string> = {
  ALERT_DUPLICATE_PAYMENT: "possible duplicate payment",
  ALERT_STOCK_SHORTFALL: "paid but short of stock",
  ALERT_REFUND: "refund reported by Paystack",
  ALERT_DISPUTE: "dispute reported by Paystack",
  ALERT_PAYMENT_MISMATCH: "payment details don't match Paystack",
  ALERT_TRANSACTION_CONFLICT: "Paystack transaction already linked to another payment",
  ALERT_UNEXPECTED_PAYMENT: "payment received for an order not awaiting payment",
  ALERT_PAYMENT_REVERSED: "confirmed payment now reported reversed or failed",
};
const ALERT_KIND_VALUES = Object.values(ALERT_KINDS) as string[];

// A stored kind is the alert kind, optionally followed by ":" and a detail that
// names what the alert is about (an attempt reference, a refund or dispute
// stage). One row per order and stored kind: the same detail is alerted once,
// a new detail (another attempt, a new dispute stage) is a new alert.
const DETAIL = /^[A-Za-z0-9._=:-]{1,160}$/;

/** The stored notification kind for an alert and optional detail. Throws on an unsafe detail. */
export function alertKey(kind: AlertKind, detail?: string | null): string {
  if (!detail) return kind;
  if (!DETAIL.test(detail)) throw new Error("Invalid alert detail");
  return `${kind}:${detail}`;
}

/** Splits a stored kind into the alert kind and its detail, or null if it isn't an owner alert. */
export function parseAlertKey(stored: string): { kind: AlertKind; detail: string | null } | null {
  const at = stored.indexOf(":");
  const kind = at === -1 ? stored : stored.slice(0, at);
  if (!ALERT_KIND_VALUES.includes(kind)) return null;
  return { kind: kind as AlertKind, detail: at === -1 ? null : stored.slice(at + 1) };
}

/** Prisma filter matching every stored owner-alert kind. */
const ANY_ALERT = ALERT_KIND_VALUES.flatMap((k) => [{ kind: k }, { kind: { startsWith: `${k}:` } }]);

export const MAX_ALERT_ATTEMPTS = 5;
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 12 * 3_600_000];
const STALE_LOCK_MS = 10 * 60_000;

/** The configured recipient, or null when unset or not an email address. */
export function ownerAlertEmail(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.OWNER_ALERT_EMAIL?.trim();
  return value && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ? value : null;
}

/**
 * Queues one alert per order, kind and detail; calling it again is a no-op.
 * INSERT … ON CONFLICT DO NOTHING, so concurrent deliveries can't race into a
 * unique violation. Works inside a transaction.
 */
export async function queueOwnerAlert(db: PrismaClient | Prisma.TransactionClient, orderId: string, kind: AlertKind, detail?: string | null) {
  await db.emailNotification.createMany({ data: [{ orderId, kind: alertKey(kind, detail) }], skipDuplicates: true });
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function renderOwnerAlert(a: {
  kind: AlertKind;
  detail?: string | null;
  reference: string;
  testMode: boolean;
  status: string;
  stockStatus: string;
  totalMinor: number;
  needsAttention: string | null;
  adminUrl: string;
}): { subject: string; text: string; html: string } {
  const title = TITLES[a.kind];
  const subject = `${a.testMode ? "[TEST] " : ""}Merven order ${a.reference}: ${title}`;
  const lines = [
    `Order ${a.reference} needs your attention: ${title}.`,
    ...(a.detail ? [`Concerning: ${a.detail.split(":").join(" · ")}`] : []),
    "",
    `Status: ${a.status} · stock ${a.stockStatus.toLowerCase().replace("_", " ")} · total ${formatKES(a.totalMinor)}${a.testMode ? " (test)" : ""}`,
    "",
    "Notes on the order:",
    (a.needsAttention ?? "(none)").slice(0, 2000),
    "",
    `Review it in the admin: ${a.adminUrl}`,
    "Nothing has been refunded or changed automatically.",
  ];
  const text = lines.join("\n");
  const html = `<p>${lines.map((l) => escapeHtml(l)).join("<br>")}</p>`;
  return { subject, text, html };
}

export type AlertSummary = { claimed: number; sent: number; failed: number; skipped: string | null };

/**
 * Sends due owner alerts. Same claim, retry and back-off rules as receipts:
 * one worker wins each alert, failures retry up to MAX_ALERT_ATTEMPTS, and a
 * duplicate run (e.g. a repeated cron call) finds nothing left to send.
 */
export async function processOwnerAlerts(
  prisma: PrismaClient,
  mailer: Mailer | null,
  opts: { siteUrl: string; ownerEmail: string | null; limit?: number; now?: () => Date },
): Promise<AlertSummary> {
  const now = opts.now ?? (() => new Date());
  if (!mailer) return { claimed: 0, sent: 0, failed: 0, skipped: "Email provider not configured" };
  if (!opts.ownerEmail) return { claimed: 0, sent: 0, failed: 0, skipped: "OWNER_ALERT_EMAIL not configured" };

  const due = await prisma.emailNotification.findMany({
    where: {
      AND: [
        { OR: ANY_ALERT },
        {
          OR: [
            { status: "PENDING", nextAttemptAt: { lte: now() } },
            { status: "SENDING", lockedAt: { lt: new Date(now().getTime() - STALE_LOCK_MS) } },
          ],
        },
      ],
      attempts: { lt: MAX_ALERT_ATTEMPTS },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: opts.limit ?? 10,
    select: { id: true, status: true, attempts: true, lockedAt: true },
  });

  const summary: AlertSummary = { claimed: 0, sent: 0, failed: 0, skipped: null };
  for (const n of due) {
    const claimed = await prisma.emailNotification.updateMany({
      where: { id: n.id, status: n.status, attempts: n.attempts, lockedAt: n.lockedAt },
      data: { status: "SENDING", lockedAt: now(), attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) continue;
    summary.claimed++;

    const note = await prisma.emailNotification.findUniqueOrThrow({
      where: { id: n.id },
      select: {
        kind: true,
        attempts: true,
        order: { select: { id: true, reference: true, testMode: true, status: true, stockStatus: true, totalMinor: true, needsAttention: true } },
      },
    });
    const o = note.order;
    const parsed = parseAlertKey(note.kind)!; // selected by ANY_ALERT
    try {
      const email = renderOwnerAlert({
        kind: parsed.kind,
        detail: parsed.detail,
        reference: o.reference,
        testMode: o.testMode,
        status: o.status,
        stockStatus: o.stockStatus,
        totalMinor: o.totalMinor,
        needsAttention: o.needsAttention,
        adminUrl: `${opts.siteUrl}/admin/orders/${o.id}`,
      });
      const res = await mailer.send({ to: opts.ownerEmail, ...email, idempotencyKey: `alert-${n.id}` });
      await prisma.emailNotification.update({
        where: { id: n.id },
        data: { status: "SENT", sentAt: now(), lockedAt: null, providerMessageId: res.messageId, lastError: null },
      });
      summary.sent++;
    } catch (e) {
      const retryable = !(e instanceof MailerError) || e.retryable;
      const exhausted = !retryable || note.attempts >= MAX_ALERT_ATTEMPTS;
      await prisma.emailNotification.update({
        where: { id: n.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          lockedAt: null,
          lastError: (e instanceof MailerError ? e.message : "Alert could not be sent").slice(0, 300),
          nextAttemptAt: new Date(now().getTime() + BACKOFF_MS[Math.min(note.attempts - 1, BACKOFF_MS.length - 1)]),
        },
      });
      summary.failed++;
      console.warn(JSON.stringify({ level: "warn", event: "owner_alert_failed", order: o.reference, kind: note.kind, attempt: note.attempts, exhausted }));
    }
  }
  return summary;
}
