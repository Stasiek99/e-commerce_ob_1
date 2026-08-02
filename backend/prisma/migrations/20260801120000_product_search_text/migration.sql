-- Typo- and abbreviation-tolerant product search.
--
-- Before this migration the search path matched raw columns with ILIKE plus an
-- exact `= ANY(lr.aliases)` array lookup. That is case-sensitive on the alias
-- side, accent-sensitive everywhere ("lancome" never matched "Lancôme"), and
-- entirely phrase-ordered — "dg the one" matched nothing because no single
-- column contains that substring.
--
-- The fix denormalizes every searchable field of a product (including its luxury
-- reference brand/name/aliases) into one normalized text column, indexed with a
-- pg_trgm GIN index. Queries then tokenize the user input and AND together one
-- index-backed predicate per token, with a trigram word-similarity fallback per
-- token for typo tolerance.
--
-- NOTE: `normalize_search_text` below is mirrored in TypeScript by
-- `normalizeSearchText` in src/modules/products/search/search-query.util.ts.
-- The two must be changed together — the TS version normalizes the query, the
-- SQL version normalizes the haystack it is compared against.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Normalizer ──────────────────────────────────────────────────────────────
-- lowercase -> fold diacritics to ASCII -> drop `&.,'’`´` WITHOUT inserting a
-- space (so "D&G" collapses to the single token "dg" while "Dolce & Gabbana"
-- collapses to "dolce gabbana") -> every other non-alphanumeric run becomes one
-- space -> trim.
--
-- Only the accented characters that actually occur in the catalog (Polish plus
-- Western European brand names) are folded; anything else degrades to a space
-- separator rather than to its base letter.
--
-- IMMUTABLE is required so the function can be used inside an index expression
-- and so the planner may fold it into constants; every operation below is
-- locale-independent for the ASCII output alphabet.
CREATE OR REPLACE FUNCTION normalize_search_text(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT btrim(
    regexp_replace(
      regexp_replace(
        translate(
          replace(replace(replace(lower(coalesce(input, '')), 'æ', 'ae'), 'œ', 'oe'), 'ß', 'ss'),
          'ąćęłńóśźżàáâãäåèéêëìíîïòôõöøùúûüýÿçñšžđþ',
          'acelnoszzaaaaaaeeeeiiiiooooouuuuyycnszdt'
        ),
        '[&.,''’`´]', '', 'g'
      ),
      '[^a-z0-9]+', ' ', 'g'
    )
  )
$$;

-- ─── Haystack builder ────────────────────────────────────────────────────────
-- Takes the product's own searchable fields plus its luxury reference id and
-- returns the normalized blob. Declared STABLE (not IMMUTABLE) because it reads
-- luxury_references; that is fine for trigger use, it just cannot be indexed
-- directly — which is why the result is materialized into a real column.
CREATE OR REPLACE FUNCTION build_product_search_text(
  p_name             text,
  p_catalog_number   text,
  p_inspired_by      text,
  p_brand            text,
  p_short_desc       text,
  p_notes            text[],
  p_scent_family     text,
  p_luxury_ref_id    integer
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lr_text text := '';
BEGIN
  IF p_luxury_ref_id IS NOT NULL THEN
    SELECT concat_ws(' ', lr.brand, lr.name, array_to_string(lr.aliases, ' '))
      INTO lr_text
      FROM luxury_references lr
     WHERE lr.id = p_luxury_ref_id;
  END IF;

  RETURN normalize_search_text(
    concat_ws(' ',
      p_name,
      p_catalog_number,
      p_inspired_by,
      p_brand,
      p_short_desc,
      array_to_string(p_notes, ' '),
      p_scent_family,
      lr_text
    )
  );
END;
$$;

-- ─── Column ──────────────────────────────────────────────────────────────────
-- Maintained exclusively by the triggers below, never written by the app. That
-- matters because AdminJS writes to this table directly, bypassing any
-- application-layer hook.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "searchText" TEXT NOT NULL DEFAULT '';

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
    NEW."luxuryReferenceId"
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_search_text_sync_trg ON "products";
CREATE TRIGGER products_search_text_sync_trg
BEFORE INSERT OR UPDATE OF
  "name", "catalogNumber", "inspiredBy", "brand", "shortDescription",
  "notes", "scentFamily", "luxuryReferenceId"
ON "products"
FOR EACH ROW
EXECUTE FUNCTION products_search_text_sync();

-- Editing a luxury reference (adding an alias, fixing a brand spelling) has to
-- propagate into every product pointing at it. The UPDATE below only touches
-- "searchText", which is deliberately absent from the trigger's UPDATE OF list,
-- so it does not re-enter products_search_text_sync().
CREATE OR REPLACE FUNCTION luxury_references_resync_products()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "products" p
     SET "searchText" = build_product_search_text(
           p."name", p."catalogNumber", p."inspiredBy", p."brand",
           p."shortDescription", p."notes", p."scentFamily", p."luxuryReferenceId")
   WHERE p."luxuryReferenceId" = NEW."id";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS luxury_references_resync_products_trg ON "luxury_references";
CREATE TRIGGER luxury_references_resync_products_trg
AFTER UPDATE OF "brand", "name", "aliases" ON "luxury_references"
FOR EACH ROW
EXECUTE FUNCTION luxury_references_resync_products();

-- ─── Backfill ────────────────────────────────────────────────────────────────
UPDATE "products" p
   SET "searchText" = build_product_search_text(
         p."name", p."catalogNumber", p."inspiredBy", p."brand",
         p."shortDescription", p."notes", p."scentFamily", p."luxuryReferenceId");

-- ─── Index ───────────────────────────────────────────────────────────────────
-- GIN + gin_trgm_ops serves both `LIKE '%token%'` (substring) and `token <%
-- "searchText"` (word similarity), which are the only two predicates the search
-- path emits per token.
CREATE INDEX IF NOT EXISTS "products_search_text_trgm_idx"
  ON "products" USING GIN ("searchText" gin_trgm_ops);
