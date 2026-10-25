import { createHash } from "node:crypto";
import { Prisma } from "@/generated/prisma/client";
import { ALERT_KINDS, queueOwnerAlert, type AlertKind } from "../notifications/owner-alerts";
import { appendNote, verifyAndApply, type PaymentDeps, type VerifyResult } from "../orders/order-service";
import { verifyWebhookSignature } from "./paystack";

// Paystack webhook handling. The payload is never trusted as proof of payment:
// after the signature check it only tells us WHICH reference to verify with
// Paystack's API. Events are deduplicated by their identifying fields; a failed
// processing attempt returns 500 so Paystack redelivers it.
//
// Refund and dispute events (names from Paystack's webhook and refund docs) are
// recorded and brought to the owner's attention: a dated note on the matching
// order and an owner alert per meaningful stage (see followUpAlertDetail). They
// never change order or payment status or stock: the schema has no refund or
// dispute state, and a refund or dispute doesn't undo the fact that the order
// was paid. Refunds are made, and disputes answered, in the Paystack dashboard.

export type WebhookOutcome = { status: number; body: string; result?: VerifyResult };

const REFERENCE = /^[A-Za-z0-9.=-]{1,100}$/;

const FOLLOW_UP_EVENTS: Record<string, AlertKind> = {
  "refund.pending": ALERT_KINDS.refund,
  "refund.processing": ALERT_KINDS.refund,
  "refund.processed": ALERT_KINDS.refund,
  "refund.failed": ALERT_KINDS.refund,
  "refund.needs-attention": ALERT_KINDS.refund, // listed on Paystack's refunds page, not its webhook list
  "charge.dispute.create": ALERT_KINDS.dispute,
  "charge.dispute.remind": ALERT_KINDS.dispute,
  "charge.dispute.resolve": ALERT_KINDS.dispute,
};

type Data = Record<string, unknown> & { transaction?: unknown };
const str = (v: unknown, pattern: RegExp) => (typeof v === "string" || typeof v === "number") && pattern.test(String(v)) ? String(v) : null;

/**
 * The transaction a refund or dispute is about. Refunds carry
 * `transaction_reference` (documented). Paystack doesn't document the dispute
 * payload, so a few likely fields are tried; nothing is linked unless the value
 * exactly matches one of our payment references.
 */
function followUpReference(data: Data): string | null {
  const nested = data.transaction && typeof data.transaction === "object" ? (data.transaction as Record<string, unknown>).reference : undefined;
  for (const candidate of [data.transaction_reference, nested, data.reference]) {
    const ref = str(candidate, REFERENCE);
    if (ref) return ref;
  }
  return null;
}

/** Short, safe token for a provider identifier: kept if plain and short, otherwise hashed. */
function token(value: string): string {
  return /^[A-Za-z0-9.=-]{1,40}$/.test(value) ? value : `h-${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

/** JSON with object keys sorted at every level, so equal payloads digest equally. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * Which owner alert a refund or dispute event belongs to (alert key detail).
 * Repeats of the same stage share a key; a new stage gets a new alert.
 * - Refund: one alert when a refund is first reported (pending, processing or
 *   processed), and another if it fails or needs attention (both need action).
 *   A refund is identified by `refund_reference` when Paystack sends one; it can
 *   be null (documented example), so then by its amount: two partial refunds of
 *   different amounts are told apart, two of the same amount without a
 *   reference cannot be, from the documented fields.
 * - Dispute: one alert when opened, one when resolved, and at most one reminder
 *   alert per day (Paystack reminds every 4 hours while unresolved). The dispute
 *   payload is not documented; `data.id` is used to tell disputes apart only if
 *   present and plain, otherwise all disputes on a payment share one identity.
 */
function followUpAlertDetail(e: { event: string; kind: AlertKind; reference: string; data: Data; day: string }): string {
  if (e.kind === ALERT_KINDS.refund) {
    const refundRef = str(e.data.refund_reference, REFERENCE);
    const amount = str(e.data.amount, /^\d{1,12}$/);
    const identity = refundRef ? `ref-${token(refundRef)}` : `amount-${amount ?? "unknown"}`;
    const stage = e.event === "refund.failed" ? "failed" : e.event === "refund.needs-attention" ? "needs-attention" : "reported";
    return `${token(e.reference)}:${identity}:${stage}`;
  }
  const disputeId = str(e.data.id, /^[A-Za-z0-9_-]{1,40}$/);
  const identity = disputeId ? `dispute-${disputeId}` : "dispute";
  const stage = e.event === "charge.dispute.create" ? "opened" : e.event === "charge.dispute.resolve" ? "resolved" : `reminder-${e.day}`;
  return `${token(e.reference)}:${identity}:${stage}`;
}

export async function handlePaystackWebhook(deps: PaymentDeps, rawBody: string, signature: string | null): Promise<WebhookOutcome> {
  if (!verifyWebhookSignature(rawBody, signature, deps.config.secretKey)) {
    log("webhook_rejected", { reason: "bad_signature" });
    return { status: 401, body: "invalid signature" };
  }
  let payload: { event?: unknown; data?: Data };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: "invalid json" };
  }
  const event = typeof payload.event === "string" ? payload.event.slice(0, 100) : "unknown";
  const data: Data = payload.data && typeof payload.data === "object" ? payload.data : {};
  const followUp = FOLLOW_UP_EVENTS[event] ?? null;
  const reference = followUp ? followUpReference(data) : str(data.reference, REFERENCE);
  const txId = data.id != null ? String(data.id).slice(0, 50) : "none";
  const txStatus = typeof data.status === "string" ? data.status.slice(0, 30) : "none";
  // Refund and dispute payloads have no documented event id, so they are keyed by
  // a digest of their whole data object: a redelivery (same event, same data) is
  // a duplicate; anything that differs (another partial refund, a new status, a
  // reminder with changed fields) is a new event. Only the digest is stored.
  const eventKey = followUp
    ? `paystack:${event}:${createHash("sha256").update(canonical(data)).digest("hex").slice(0, 40)}`
    : `paystack:${event}:${txId}:${txStatus}`;

  // Deduplicate. A previously processed or ignored event is acknowledged again.
  let record: { id: string; status: string };
  try {
    record = await deps.prisma.webhookEvent.create({ data: { eventKey, event, reference }, select: { id: true, status: true } });
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    record = await deps.prisma.webhookEvent.findUniqueOrThrow({ where: { eventKey }, select: { id: true, status: true } });
    if (record.status === "PROCESSED" || record.status === "IGNORED") return { status: 200, body: "duplicate" };
  }

  const finish = (status: "PROCESSED" | "IGNORED" | "FAILED", error?: string) =>
    deps.prisma.webhookEvent.update({ where: { id: record.id }, data: { status, error: error ?? null, processedAt: new Date() } });

  if (followUp) return handleFollowUp(deps, { event, kind: followUp, reference, data, status: txStatus }, finish);

  if (event !== "charge.success" || !reference) {
    await finish("IGNORED");
    return { status: 200, body: "ignored" };
  }
  const known = await deps.prisma.paymentAttempt.findUnique({ where: { reference }, select: { id: true } });
  if (!known) {
    await finish("IGNORED", "unknown reference");
    log("webhook_unknown_reference", { event });
    return { status: 200, body: "ignored" };
  }

  const result = await verifyAndApply(deps, reference);
  if (result.outcome === "unverified") {
    await finish("FAILED", "Paystack verify unavailable");
    return { status: 500, body: "retry later", result };
  }
  if (result.outcome === "test_database_not_approved") {
    // Nothing was written. Not "processed": let Paystack redeliver once fixed.
    await finish("FAILED", "Database not approved for test payments");
    return { status: 503, body: "payments unavailable", result };
  }
  await finish("PROCESSED");
  log("webhook_processed", { reference, outcome: result.outcome });
  return { status: 200, body: "ok", result };
}

/**
 * Refund or dispute: note it on the matching order and alert the owner once.
 * The payload's customer details are never stored or logged.
 */
async function handleFollowUp(
  deps: PaymentDeps,
  e: { event: string; kind: AlertKind; reference: string | null; data: Data; status: string },
  finish: (status: "PROCESSED" | "IGNORED" | "FAILED", error?: string) => Promise<unknown>,
): Promise<WebhookOutcome> {
  const attempt = e.reference
    ? await deps.prisma.paymentAttempt.findUnique({ where: { reference: e.reference }, select: { orderId: true, testMode: true } })
    : null;
  if (!attempt) {
    await finish("IGNORED", "no matching payment");
    // Still visible in the logs: a refund or dispute the shop should look at in Paystack.
    console.warn(JSON.stringify({ level: "warn", event: "webhook_follow_up_unmatched", paystackEvent: e.event }));
    return { status: 200, body: "ignored" };
  }
  if (attempt.testMode !== (deps.config.mode === "test")) {
    await finish("IGNORED", "mode mismatch");
    return { status: 200, body: "ignored" };
  }

  const amount = str(e.data.amount, /^\d{1,12}$/);
  const currency = str(e.data.currency, /^[A-Z]{3}$/);
  const status = /^[a-z_-]{1,30}$/.test(e.status) ? e.status : "unknown";
  const what = e.kind === ALERT_KINDS.refund ? "a refund" : "a dispute";
  const refundRef = e.kind === ALERT_KINDS.refund ? str(e.data.refund_reference, REFERENCE) : null;
  const disputeId = e.kind === ALERT_KINDS.dispute ? str(e.data.id, /^[A-Za-z0-9_-]{1,40}$/) : null;
  const day = new Date().toISOString().slice(0, 10);
  const text =
    `${day}: Paystack reported ${what} (${e.event}, status ${status}) on payment ${e.reference}` +
    (refundRef ? ` (refund ${token(refundRef)})` : "") +
    (disputeId ? ` (dispute ${disputeId})` : "") +
    (amount ? `, amount ${amount}${currency ? ` ${currency}` : ""} as Paystack reported it (smallest currency unit)` : "") +
    ". Order and payment status are unchanged: review it in the Paystack dashboard.";
  await appendNote(deps.prisma, attempt.orderId, text);
  await queueOwnerAlert(deps.prisma, attempt.orderId, e.kind, followUpAlertDetail({ event: e.event, kind: e.kind, reference: e.reference!, data: e.data, day }));
  await finish("PROCESSED");
  log("webhook_follow_up_recorded", { paystackEvent: e.event, reference: e.reference });
  return { status: 200, body: "ok", result: { outcome: "needs_attention", orderId: attempt.orderId, stockChanged: false, receiptQueued: false } };
}

function log(event: string, data: Record<string, unknown>) {
  console.info(JSON.stringify({ level: "info", event, ...data }));
}
