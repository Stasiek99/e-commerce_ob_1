-- One vote per user per review — composite PK enforces the unique constraint.
-- Cascades keep the table consistent when a review or user is deleted.
CREATE TABLE "review_helpful_votes" (
  "review_id" TEXT NOT NULL,
  "user_id"   TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "review_helpful_votes_pkey" PRIMARY KEY ("review_id", "user_id")
);

ALTER TABLE "review_helpful_votes"
  ADD CONSTRAINT "review_helpful_votes_review_id_fkey"
  FOREIGN KEY ("review_id") REFERENCES "reviews"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_helpful_votes"
  ADD CONSTRAINT "review_helpful_votes_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
