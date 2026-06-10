-- Add family as nullable first, backfill existing rows, then enforce NOT NULL
ALTER TABLE "refresh_tokens" ADD COLUMN "family" TEXT;
ALTER TABLE "refresh_tokens" ADD COLUMN "replacedBy" TEXT;

-- Each legacy row forms its own singleton family so reuse detection ignores them
UPDATE "refresh_tokens" SET "family" = gen_random_uuid()::text WHERE "family" IS NULL;

ALTER TABLE "refresh_tokens" ALTER COLUMN "family" SET NOT NULL;

-- CreateIndex
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens"("family");
