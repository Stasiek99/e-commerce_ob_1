-- Indexes missing from Product and ProductVariant models.
-- Postgres does NOT auto-create indexes on referencing FK columns; only the
-- referenced PK/unique column gets an index automatically. Without these,
-- every category-filtered product list query does a full table scan.

-- Covers the common WHERE isActive=true AND status IN (...) AND categoryId=X pattern.
CREATE INDEX "products_categoryId_isActive_status_idx" ON "products" ("categoryId", "isActive", "status");

-- Covers the default all-products listing ORDER BY sortOrder path.
CREATE INDEX "products_isActive_status_sortOrder_idx" ON "products" ("isActive", "status", "sortOrder");

-- Without this, fetching variants for a page of products scans product_variants
-- fully for each IN (...productIds...) batch.
CREATE INDEX "product_variants_productId_isActive_idx" ON "product_variants" ("productId", "isActive");
