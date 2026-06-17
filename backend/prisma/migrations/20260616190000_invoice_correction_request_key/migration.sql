-- Replace the (orderId, correctedAmountInCents) idempotency key with one keyed
-- on correction identity (sha256 of the cancelled orderItemId:quantity pairs),
-- not the resulting refund amount. Two unrelated partial cancellations that
-- happen to net to the same amount were previously colliding and silently
-- swallowing the second corrective invoice.

ALTER TABLE "invoice_corrections" ADD COLUMN "correctionRequestKey" TEXT;

-- Backfill existing rows with a key derived from their own row id, so they
-- remain unique under the new constraint without needing the original
-- per-item cancellation data (which was never stored).
UPDATE "invoice_corrections" SET "correctionRequestKey" = "id" WHERE "correctionRequestKey" IS NULL;

ALTER TABLE "invoice_corrections" ALTER COLUMN "correctionRequestKey" SET NOT NULL;

ALTER TABLE "invoice_corrections" DROP CONSTRAINT "invoice_corrections_orderId_correctedAmountInCents_key";

ALTER TABLE "invoice_corrections" ADD CONSTRAINT "invoice_corrections_orderId_correctionRequestKey_key" UNIQUE ("orderId", "correctionRequestKey");
