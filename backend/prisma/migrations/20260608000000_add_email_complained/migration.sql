-- AlterTable: add emailComplained flag to users
ALTER TABLE "users" ADD COLUMN "emailComplained" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "emailComplainedAt" TIMESTAMP(3);
