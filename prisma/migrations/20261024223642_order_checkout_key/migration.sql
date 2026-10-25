-- Bag checkout idempotency. A bag checkout stores an HMAC of the browser's bag
-- session and its basket; two submissions of the same bag converge on one unpaid
-- order. The index is partial: once an order is PAID or CANCELLED the same
-- basket can be ordered again. Buy now orders keep NULL, which never conflicts.
-- Generated with `prisma migrate diff` from the schema (partialIndexes preview feature).

-- AlterTable
ALTER TABLE "order" ADD COLUMN     "checkoutKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "order_pending_checkout_key" ON "order"("checkoutKey") WHERE ("status" = 'PENDING_PAYMENT');
