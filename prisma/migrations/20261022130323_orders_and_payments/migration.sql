-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockStatus" AS ENUM ('NOT_APPLIED', 'DEDUCTED', 'SHORTFALL');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIALIZING', 'PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REVERSED');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "order" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "stockStatus" "StockStatus" NOT NULL DEFAULT 'NOT_APPLIED',
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KES',
    "subtotalMinor" INTEGER NOT NULL,
    "totalMinor" INTEGER NOT NULL,
    "needsAttention" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "productSlug" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "colour" TEXT NOT NULL,
    "unitPriceMinor" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "lineTotalMinor" INTEGER NOT NULL,

    CONSTRAINT "order_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "reference" TEXT NOT NULL,
    "testMode" BOOLEAN NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'INITIALIZING',
    "amountMinor" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "authorizationUrl" TEXT,
    "providerTransactionId" TEXT,
    "channel" TEXT,
    "paidAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_event" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'paystack',
    "eventKey" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "reference" TEXT,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "webhook_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_notification" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "order_reference_key" ON "order"("reference");

-- CreateIndex
CREATE INDEX "order_status_createdAt_idx" ON "order"("status", "createdAt");

-- CreateIndex
CREATE INDEX "order_item_orderId_idx" ON "order_item"("orderId");

-- CreateIndex
CREATE INDEX "order_item_variantId_idx" ON "order_item"("variantId");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_reference_key" ON "payment_attempt"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attempt_providerTransactionId_key" ON "payment_attempt"("providerTransactionId");

-- CreateIndex
CREATE INDEX "payment_attempt_orderId_createdAt_idx" ON "payment_attempt"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_event_eventKey_key" ON "webhook_event"("eventKey");

-- CreateIndex
CREATE INDEX "email_notification_status_nextAttemptAt_idx" ON "email_notification"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "email_notification_orderId_kind_key" ON "email_notification"("orderId", "kind");

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "product_variant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_notification" ADD CONSTRAINT "email_notification_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity rules Prisma cannot express.
ALTER TABLE "order" ADD CONSTRAINT "order_amounts_valid" CHECK ("subtotalMinor" >= 0 AND "totalMinor" >= 0);
ALTER TABLE "order" ADD CONSTRAINT "order_currency_kes" CHECK ("currency" = 'KES');
ALTER TABLE "order" ADD CONSTRAINT "order_paid_has_time" CHECK ("status" <> 'PAID' OR "paidAt" IS NOT NULL);
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "order_item" ADD CONSTRAINT "order_item_prices_valid" CHECK ("unitPriceMinor" >= 0 AND "lineTotalMinor" = "unitPriceMinor" * "quantity");
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_amount_positive" CHECK ("amountMinor" > 0);
ALTER TABLE "payment_attempt" ADD CONSTRAINT "payment_attempt_currency_kes" CHECK ("currency" = 'KES');
ALTER TABLE "email_notification" ADD CONSTRAINT "email_notification_attempts_valid" CHECK ("attempts" >= 0);

-- Same Data API lockdown as every other table (see lock_down_supabase_data_api).
ALTER TABLE "order"              ENABLE ROW LEVEL SECURITY;
ALTER TABLE "order_item"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_attempt"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "webhook_event"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "email_notification" ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon')
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "order", "order_item", "payment_attempt", "webhook_event", "email_notification" FROM anon, authenticated;
  END IF;
END $$;
