-- Replace IP+UA hash with a first-party UUID consent identifier.
-- session_hash is personal data under GDPR Recital 26; a random UUID is not.
ALTER TABLE "consent_logs" RENAME COLUMN "session_hash" TO "consent_id";

-- Add 5-year expiry so rows have a defined retention boundary.
-- Existing rows (if any) get an expiry of 5 years from their consented_at timestamp.
ALTER TABLE "consent_logs" ADD COLUMN "expires_at" TIMESTAMP(3) NOT NULL
  DEFAULT NOW();

UPDATE "consent_logs"
  SET "expires_at" = "consented_at" + INTERVAL '5 years';

ALTER TABLE "consent_logs" ALTER COLUMN "expires_at" DROP DEFAULT;
