-- Extends the product search haystack with the category name and product line.
--
-- Motivation: the catalog has 12 products in "Dyfuzory i odświeżacze", but the
-- word "dyfuzor" appears in no product name, description or note — so a shopper
-- searching for it got zero results while the category page sat one click away.
-- Same for "żele" and for line names ("Millesime", "Luxury"), which customers use
-- as search terms because they are printed on the product cards.
--
-- build_product_search_text() gains two parameters, so the old signature is
-- dropped rather than CREATE OR REPLACE'd — replacing with a different argument
-- list would create an overload and leave the trigger bound to the stale one.

DROP FUNCTION IF EXISTS build_product_search_text(text, text, text, text, text, text[], text, integer);

CREATE FUNCTION build_product_search_text(
  p_name             text,
  p_catalog_number   text,
  p_inspired_by      text,
  p_brand            text,
  p_short_desc       text,
  p_notes            text[],
  p_scent_family     text,
  p_luxury_ref_id    integer,
  p_category_id      text,
  p_line             text
)
RETURNS text
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  lr_text       text := '';
  category_name text := '';
BEGIN
  IF p_luxury_ref_id IS NOT NULL THEN
    SELECT concat_ws(' ', lr.brand, lr.name, array_to_string(lr.aliases, ' '))
      INTO lr_text
      FROM luxury_references lr
     WHERE lr.id = p_luxury_ref_id;
  END IF;

  IF p_category_id IS NOT NULL THEN
    SELECT c.name INTO category_name FROM categories c WHERE c.id = p_category_id;
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
      p_line,
      category_name,
      lr_text
    )
  );
END;
$$;

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
  RETURN NEW;
END;
$$;

-- categoryId and line join the columns that invalidate the haystack.
DROP TRIGGER IF EXISTS products_search_text_sync_trg ON "products";
CREATE TRIGGER products_search_text_sync_trg
BEFORE INSERT OR UPDATE OF
  "name", "catalogNumber", "inspiredBy", "brand", "shortDescription",
  "notes", "scentFamily", "luxuryReferenceId", "categoryId", "line"
ON "products"
FOR EACH ROW
EXECUTE FUNCTION products_search_text_sync();

CREATE OR REPLACE FUNCTION luxury_references_resync_products()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "products" p
     SET "searchText" = build_product_search_text(
           p."name", p."catalogNumber", p."inspiredBy", p."brand",
           p."shortDescription", p."notes", p."scentFamily", p."luxuryReferenceId",
           p."categoryId", p."line")
   WHERE p."luxuryReferenceId" = NEW."id";
  RETURN NULL;
END;
$$;

-- Renaming a category has to propagate the same way an alias edit does.
CREATE OR REPLACE FUNCTION categories_resync_products()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE "products" p
     SET "searchText" = build_product_search_text(
           p."name", p."catalogNumber", p."inspiredBy", p."brand",
           p."shortDescription", p."notes", p."scentFamily", p."luxuryReferenceId",
           p."categoryId", p."line")
   WHERE p."categoryId" = NEW."id";
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS categories_resync_products_trg ON "categories";
CREATE TRIGGER categories_resync_products_trg
AFTER UPDATE OF "name" ON "categories"
FOR EACH ROW
EXECUTE FUNCTION categories_resync_products();

UPDATE "products" p
   SET "searchText" = build_product_search_text(
         p."name", p."catalogNumber", p."inspiredBy", p."brand",
         p."shortDescription", p."notes", p."scentFamily", p."luxuryReferenceId",
         p."categoryId", p."line");
