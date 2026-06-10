-- Add analytics consent fields to users table
ALTER TABLE "users" ADD COLUMN "analyticsConsent" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "users" ADD COLUMN "analyticsConsentAt" TIMESTAMP(3);

-- Create consent_logs table for anonymous visitor consent audit trail
CREATE TABLE "consent_logs" (
    "id" TEXT NOT NULL,
    "session_hash" TEXT NOT NULL,
    "analytics" BOOLEAN NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "consent_logs_pkey" PRIMARY KEY ("id")
);
