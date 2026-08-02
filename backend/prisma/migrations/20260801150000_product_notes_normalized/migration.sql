-- Normalized olfactory notes, for the fragrance finder's note-matching.
--
-- `products.notes` stores display strings as printed on the data sheet:
-- capitalized, accented, and sometimes repeated within one product ("Cedr"
-- appears twice in several pyramids because it is both a heart and a base note).
-- Matching a user's note selection against that directly means every comparison
-- pays a lower()/btrim() per element, which no index can serve, and the duplicate
-- entries skew the precision term of the match score.
--
-- This column holds the deduplicated, normalized set — same normalizer as
-- "searchText", so a note picked in the finder and a note typed into the search
-- bar reduce to the same key. GIN-indexed for the `&&` overlap prefilter.

CREATE OR REPLACE FUNCTION build_product_notes_normalized(p_notes text[])
RETURNS text[]
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(array_agg(DISTINCT s.v ORDER BY s.v), '{}'::text[])
    FROM (
      SELECT normalize_search_text(n) AS v
        FROM unnest(COALESCE(p_notes, '{}'::text[])) AS n
    ) s
   WHERE s.v <> '';
$$;

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "notesNormalized" TEXT[] NOT NULL DEFAULT '{}';

-- Folded into the existing haystack trigger rather than given its own: both
-- columns derive from the same row and must never be updated independently.
CREATE OR REPLACE FUNCTION products_search_text_sync()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."searchText" := build_product_search_text(
    NEW."name",
    NEW."catalogNumber",
    NEW."inspiredBy",
    NEW."brand",
    NEW."shortDescription",
    NEW."notes",
    NEW."scentFamily",
    NEW."luxuryReferenceId",
    NEW."categoryId",
    NEW."line"
  );
  NEW."notesNormalized" := build_product_notes_normalized(NEW."notes");
  RETURN NEW;
END;
$$;

UPDATE "products" p
   SET "notesNormalized" = build_product_notes_normalized(p."notes");

CREATE INDEX IF NOT EXISTS "products_notes_normalized_gin_idx"
  ON "products" USING GIN ("notesNormalized");

ANALYZE "products";
