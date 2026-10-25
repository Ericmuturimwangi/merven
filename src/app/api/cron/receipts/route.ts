import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { siteUrl } from "@/env";
import { safeErrorFields } from "@/lib/error-report";
import { db } from "@/server/db";
import { configuredMailer } from "@/server/notifications/mailer";
import { ownerAlertEmail, processOwnerAlerts } from "@/server/notifications/owner-alerts";
import { processReceipts } from "@/server/notifications/receipts";
import { runPaymentRecovery } from "@/server/payments/runtime";

// Daily safety net (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"):
// first recovers payments whose webhook was lost (re-verifying recent attempts
// with Paystack, bounded; skipped while payments are disabled), then delivers
// queued receipts and owner alerts. Fails closed when CRON_SECRET is not
// configured. Vercel delivers cron calls on a best-effort basis and may call
// twice: each queued email is claimed atomically, so a repeated run sends
// nothing twice, and a missed run is caught up by the next one. Vercel does not
// retry a failed run, so receipts and alerts are processed independently.
// Recovery makes up to 20 sequential Paystack calls (10 s timeout each, stopping
// after repeated failures), then sends emails.
export const maxDuration = 300;

export async function GET(request: Request) {
  await connection(); // never prerender: secrets and the queue are read at request time
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) return new Response("not configured", { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return new Response("unauthorized", { status: 401 });

  const mailer = configuredMailer();
  let failed = false;
  const run = async <T,>(event: string, task: () => Promise<T>): Promise<T | { error: true }> => {
    try {
      return await task();
    } catch (e) {
      failed = true;
      console.error(JSON.stringify({ level: "error", event, ...safeErrorFields(e) }));
      return { error: true };
    }
  };
  // Before receipts and alerts, so anything it recovers is sent in this run.
  const recovery = await run("cron_recovery_failed", () => runPaymentRecovery({ limit: 20 }));
  const receipts = await run("cron_receipts_failed", () => processReceipts(db, mailer, { siteUrl: siteUrl(), limit: 25 }));
  const alerts = await run("cron_alerts_failed", () => processOwnerAlerts(db, mailer, { siteUrl: siteUrl(), ownerEmail: ownerAlertEmail(), limit: 25 }));
  return Response.json({ ...receipts, alerts, recovery }, { status: failed ? 500 : 200 });
}
