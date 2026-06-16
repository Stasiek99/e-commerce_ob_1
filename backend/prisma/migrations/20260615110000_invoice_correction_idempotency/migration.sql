-- Make correctiveStoragePath nullable for two-phase generation idempotency
ALTER TABLE "invoice_corrections" ALTER COLUMN "correctiveStoragePath" DROP NOT NULL;

-- Prevent duplicate corrective invoices on BullMQ retry (Art. 106e ust. 1 pkt 2 gap guard)
ALTER TABLE "invoice_corrections" ADD CONSTRAINT "invoice_corrections_orderId_correctedAmountInCents_key" UNIQUE ("orderId", "correctedAmountInCents");
