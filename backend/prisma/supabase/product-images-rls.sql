-- Supabase Storage — product-images bucket setup
--
-- Apply via Supabase Dashboard → SQL Editor. Idempotent: safe to re-run.
--
-- Why this file is so short: Supabase already gives us the security posture we
-- want without any custom RLS policies.
--
--   1. Reads: marking the bucket `public = true` routes GETs through the CDN
--      without hitting RLS on storage.objects at all. That's how product images
--      load on the storefront.
--
--   2. Writes: the backend uses SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
--      unconditionally. No policy is needed (or wanted) to grant it access.
--
--   3. anon / authenticated writes: Supabase's default on storage.objects is
--      "deny unless a permissive policy matches." We don't create any matching
--      policy, so anon and authenticated clients have no INSERT/UPDATE/DELETE
--      access. That's the behavior we want.
--
-- Note: we used to create explicit deny policies here for defense-in-depth, but
-- newer Supabase projects lock down ownership of storage.objects so CREATE
-- POLICY / ALTER TABLE from the SQL editor fails with
-- "ERROR: 42501: must be owner of table objects". If you want belt-and-braces
-- deny policies anyway, add them through the Dashboard UI:
--   Storage → Policies → New policy → For SELECT/INSERT/UPDATE/DELETE,
--   target roles anon + authenticated, USING expression `false`.

-- Ensure the bucket exists and is marked public (CDN reads).
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do update set public = excluded.public;
