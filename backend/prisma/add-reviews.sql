-- Reviews Feature Migration
-- Creates the reviews table, ReviewStatus enum, and rating stats columns on products.
-- Apply manually via Supabase SQL Editor or: psql $DATABASE_URL -f add-reviews.sql
-- For Prisma-managed flow: pnpm db:migrate (dev) or pnpm prisma:migrate:prod (prod)

-- ─── Enum ─────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Products: add rating stats columns ───────────────────────────────────────

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "review_count"  INTEGER          NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "avg_rating"    DOUBLE PRECISION;

-- ─── Reviews table ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "reviews" (
    "id"             TEXT           NOT NULL,
    "product_id"     TEXT           NOT NULL,
    "user_id"        TEXT           NOT NULL,
    "order_id"       TEXT,
    "rating"         INTEGER        NOT NULL,
    "title"          TEXT,
    "body"           TEXT,
    "status"         "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "admin_reply"    TEXT,
    "helpful_count"  INTEGER        NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- One review per user per product
CREATE UNIQUE INDEX IF NOT EXISTS "reviews_user_id_product_id_key"
    ON "reviews" ("user_id", "product_id");

-- Fast approved-review lookup per product (used by getByProduct)
CREATE INDEX IF NOT EXISTS "reviews_product_id_status_idx"
    ON "reviews" ("product_id", "status");

-- "My reviews" user-scoped queries
CREATE INDEX IF NOT EXISTS "reviews_user_id_idx"
    ON "reviews" ("user_id");

-- ─── Foreign Keys ─────────────────────────────────────────────────────────────

ALTER TABLE "reviews"
    ADD CONSTRAINT IF NOT EXISTS "reviews_product_id_fkey"
    FOREIGN KEY ("product_id") REFERENCES "products" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
    ADD CONSTRAINT IF NOT EXISTS "reviews_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reviews"
    ADD CONSTRAINT IF NOT EXISTS "reviews_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders" ("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
