-- CreateTable
CREATE TABLE "shipping_rates" (
    "carrier_code" TEXT NOT NULL,
    "price_in_cents" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_rates_pkey" PRIMARY KEY ("carrier_code")
);

-- Seed initial rates (matches the compile-time constants that were removed)
INSERT INTO "shipping_rates" ("carrier_code", "price_in_cents", "is_active", "updated_at") VALUES
    ('INPOST',      1499, true, NOW()),
    ('DHL',         1999, true, NOW()),
    ('GLS',         1799, true, NOW()),
    ('DPD',         1599, true, NOW()),
    ('DPD_COURIER', 1699, true, NOW());
