-- Returns Feature Migration
-- Creates ReturnType/ReturnStatus enums and return_requests table.
-- Apply manually: psql $DATABASE_URL -f add-returns.sql
-- Or via Prisma: pnpm db:migrate (dev) / pnpm prisma:migrate:prod (prod)

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ReturnType" AS ENUM ('WITHDRAWAL', 'COMPLAINT');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'COMPLETED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "return_requests" (
    "id"           TEXT           NOT NULL,
    "order_number" TEXT           NOT NULL,
    "email"        TEXT           NOT NULL,
    "first_name"   TEXT           NOT NULL,
    "last_name"    TEXT           NOT NULL,
    "phone"        TEXT,
    "type"         "ReturnType"   NOT NULL DEFAULT 'WITHDRAWAL',
    "delivery_date"         TIMESTAMP(3),
    "items"                 JSONB          NOT NULL DEFAULT '[]',
    "reason"                TEXT,
    "requested_resolution"  TEXT,
    "bank_account"          TEXT,
    "status"       "ReturnStatus" NOT NULL DEFAULT 'PENDING',
    "admin_note"   TEXT,
    "created_at"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_requests_pkey" PRIMARY KEY ("id")
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "return_requests_email_idx"
    ON "return_requests" ("email");

CREATE INDEX IF NOT EXISTS "return_requests_order_number_idx"
    ON "return_requests" ("order_number");
