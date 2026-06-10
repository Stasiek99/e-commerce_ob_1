-- EU Omnibus Directive price history
-- Append-only log of every priceInCents change per variant.
-- Used to compute the lowest price in the preceding 30 days when a
-- promotional (sale) price is shown alongside compareAtPriceInCents.

CREATE TABLE "product_variant_price_history" (
    "id"           TEXT         NOT NULL DEFAULT gen_random_uuid()::text,
    "variant_id"   TEXT         NOT NULL,
    "price_in_cents" INTEGER    NOT NULL,
    "recorded_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_variant_price_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_variant_price_history_variant_id_recorded_at_idx"
    ON "product_variant_price_history"("variant_id", "recorded_at");

ALTER TABLE "product_variant_price_history"
    ADD CONSTRAINT "product_variant_price_history_variant_id_fkey"
    FOREIGN KEY ("variant_id")
    REFERENCES "product_variants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
