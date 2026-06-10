-- Add timezone field to coupons table so date entries are interpreted
-- relative to a known timezone (defaults to Europe/Warsaw) rather than
-- being stored as ambiguous UTC without documented intent.
ALTER TABLE "coupons" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Europe/Warsaw';
