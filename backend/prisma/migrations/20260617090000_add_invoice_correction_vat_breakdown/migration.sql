-- Per-VAT-rate gross delta for a single corrective invoice, keyed by VAT
-- rate basis points (e.g. "2300" -> deltaGrossCents). Without this, every
-- corrective invoice recomputed its "original" (pre-correction) taxable
-- base from the pristine, never-corrected order total, so a second partial
-- cancellation touching an already-corrected VAT rate showed an "original"
-- column inconsistent with the prior corrective invoice's "corrected"
-- column (Art. 106j ust. 2 Ustawy o VAT requires continuity between them).
-- NULL on existing rows — historical corrections cannot be backfilled
-- without re-deriving cancelled-item data that was never stored.

ALTER TABLE "invoice_corrections" ADD COLUMN "vatBreakdownByRate" JSONB;
