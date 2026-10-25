import "server-only";
import { safeErrorFields } from "@/lib/error-report";
import { revalidateTag } from "next/cache";
import { siteUrl } from "@/env";
import { CATALOGUE_TAG } from "../catalogue/queries";
import { db } from "../db";
import { configuredMailer } from "../notifications/mailer";
import { ownerAlertEmail, processOwnerAlerts } from "../notifications/owner-alerts";
import { processReceipts } from "../notifications/receipts";
import { recoverAttempts, type EnabledPaymentConfig, type PaymentDeps, type RecoverySummary } from "../orders/order-service";
import { paymentConfig } from "./config";
import { createPaystackClient } from "./paystack";
import { databaseApprovedFor } from "./test-database";

// Wires the payment services to the real database, Paystack and mailer.
// Returns null when payments are disabled (fail-closed): the configuration must
// be valid AND the connected database must suit its mode (test: carries the
// test-payments marker; live: carries none). Every checkout action, the
// callback, the webhook and the admin re-check go through here.

let warnedDatabase = false;

export async function paymentDeps(): Promise<PaymentDeps | null> {
  const config = paymentConfig();
  if (!config.enabled) return null;
  if (!(await databaseApprovedFor(db, config.mode, config.testDatabaseToken))) {
    if (!warnedDatabase) {
      warnedDatabase = true;
      const reason =
        config.mode === "test"
          ? "Database is not approved for test payments (marker missing or mismatched)."
          : "Database carries a test-payments marker: live payments are refused on it.";
      console.warn(JSON.stringify({ level: "warn", event: "payments_disabled", reason }));
    }
    return null;
  }
  return {
    prisma: db,
    paystack: createPaystackClient({ secretKey: config.secretKey, baseUrl: config.apiBaseUrl }),
    config: config as EnabledPaymentConfig,
  };
}

/** After a confirmation: refresh catalogue stock (route handlers), send queued receipts and owner alerts. */
export async function afterPaymentChange(result: { stockChanged: boolean; receiptQueued: boolean; orderId?: string }, opts: { revalidate: boolean }) {
  if (result.stockChanged && opts.revalidate) revalidateTag(CATALOGUE_TAG, { expire: 0 });
  if (result.receiptQueued) {
    try {
      await processReceipts(db, configuredMailer(), { siteUrl: siteUrl(), orderId: result.orderId, limit: 1 });
    } catch (e) {
      // The receipt stays queued; the cron route retries it.
      console.error(JSON.stringify({ level: "error", event: "receipt_processing_error", ...safeErrorFields(e) }));
    }
  }
  // Alerts can concern another order too (a duplicate pair), so send whatever is due.
  try {
    await processOwnerAlerts(db, configuredMailer(), { siteUrl: siteUrl(), ownerEmail: ownerAlertEmail(), limit: 5 });
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "owner_alert_processing_error", ...safeErrorFields(e) }));
  }
}

/** What the storefront may know (never the key): online checkout is usable here. */
export async function paymentAvailability(): Promise<{ available: boolean; testMode: boolean }> {
  const deps = await paymentDeps();
  return { available: deps !== null, testMode: deps?.config.mode === "test" };
}

/**
 * Recovery of payments whose webhook was lost (see recoverAttempts), for the
 * cron route and the admin. Fail-closed: skipped when payments are disabled or
 * the database doesn't suit the mode. Stock changes refresh the catalogue;
 * queued receipts and alerts are sent by the caller's usual processing.
 */
export async function runPaymentRecovery(opts: { limit: number }): Promise<RecoverySummary | { disabled: string }> {
  const deps = await paymentDeps();
  if (!deps) return { disabled: "payments disabled" };
  const summary = await recoverAttempts(deps, { limit: opts.limit });
  if (summary.stockChanged) revalidateTag(CATALOGUE_TAG, { expire: 0 });
  return summary;
}
