-- Demote-then-promote application code is not atomic and can leave two (or
-- zero) addresses with isDefault = true under concurrent writes. This partial
-- unique index is the DB-level backstop: at most one default address per user.
-- Not expressible via Prisma's schema DSL (no WHERE clause on @@unique), so it
-- is hand-written here, same as the CHECK constraints in
-- 20260530110000_add_check_constraints_on_numeric_fields.
CREATE UNIQUE INDEX "addresses_one_default_per_user" ON "addresses"("userId") WHERE "isDefault" = true;
