-- EU Cosmetics Regulation 1223/2009 — mandatory disclosure for distance selling
-- Allergens listed individually (outside "parfum") exceed the 0.001% leave-on threshold
-- and must be visible on the product detail page before purchase.

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "ingredients" TEXT,
  ADD COLUMN IF NOT EXISTS "allergens"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS "paoMonths"   INTEGER,
  ADD COLUMN IF NOT EXISTS "warnings"    TEXT;

-- invoiceNumber was added to the schema but never migrated to the DB.
-- Add the column (nullable) and its unique constraint if not already present.
ALTER TABLE "orders"
  ADD COLUMN IF NOT EXISTS "invoiceNumber" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_invoiceNumber_key'
      AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_invoiceNumber_key" UNIQUE ("invoiceNumber");
  END IF;
END $$;
