-- Make corrective_storage_path nullable for two-phase generation idempotency
ALTER TABLE "invoice_corrections" ALTER COLUMN "corrective_storage_path" DROP NOT NULL;

-- Prevent duplicate corrective invoices on BullMQ retry (Art. 106e ust. 1 pkt 2 gap guard)
ALTER TABLE "invoice_corrections" ADD CONSTRAINT "invoice_corrections_order_id_corrected_amount_in_cents_key" UNIQUE ("order_id", "corrected_amount_in_cents");
