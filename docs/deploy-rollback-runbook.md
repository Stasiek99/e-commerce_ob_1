# Deploy Rollback Runbook — "Migration Applied Cleanly, New Code Is Broken"

**Scope:** Railway backend deploys where `pnpm --filter backend exec prisma migrate deploy` (the `preDeployCommand` in [`railway.json`](../railway.json)) succeeded, but the new app code is misbehaving in production (errors spiking, a feature broken, a crash loop).

**Not in scope:** data loss / restore-from-backup scenarios — see the backup gate noted in `CLAUDE.md` → Deployment → Railway. This runbook is about *code* rollback safety once a migration has already landed on the live database.

---

## Why this is harder than a normal rollback

Prisma migrations in this repo are **forward-only** — there is no generated `down.sql`, and `prisma migrate deploy` only ever applies new migrations, never reverts one. That means:

- Railway's "Rollback" / "Redeploy previous version" action only swaps the **app code** (Docker image + env vars). It does **not** revert the database schema.
- If the migration that shipped alongside the broken code changed the schema in a way the *previous* code can't tolerate, rolling back the code re-introduces a second incompatibility instead of fixing the first one.
- Railway's docs do not explicitly state whether `preDeployCommand` re-runs on a Rollback/Redeploy action. Treat it as **not re-running** (Rollback is documented as restoring "the Docker image and custom variables," not re-executing the build/deploy pipeline) — but verify this in the deployment logs the first time you do it (see Step 3 below), don't assume.

---

## Decision tree

```
Is the broken code paired with a migration in this deploy?
  └─ No (pure app-code bug, schema unchanged since last good deploy)
        → Safe to roll back app code only. Use Railway "Rollback" to the
          previous deployment. No DB action needed.

  └─ Yes → Is the migration purely ADDITIVE? (see checklist below)
              └─ Yes → Safe to roll back app code. The old code simply
                        ignores the new column/table/index it doesn't
                        know about. Roll back, then fix forward.

              └─ No  → Rollback is UNSAFE. Rolling back the code would
                        run against a schema the old code cannot handle
                        (missing column it expects, NOT NULL it can't
                        satisfy, dropped column/table it still reads).
                        → Do NOT click Rollback.
                        → Fix forward instead (see "Unsafe to roll back" below).
```

---

## Additive-safe vs. breaking migration checklist

Check the migration SQL in `backend/prisma/migrations/<latest>/migration.sql` against this table.

| Change | Safe to roll back app code? | Why |
|---|---|---|
| `ADD COLUMN ... NULL` (or with a `DEFAULT`) | ✅ Safe | Old code never selects/writes the new column; existing rows already satisfy the constraint |
| `CREATE TABLE` (new table, nothing references it yet) | ✅ Safe | Old code doesn't query it |
| `CREATE INDEX` | ✅ Safe | Indexes are transparent to application code |
| New enum value added (`ALTER TYPE ... ADD VALUE`) | ⚠️ Usually safe | Safe unless old code has an exhaustive `switch`/Prisma enum mapping that throws on an unrecognized value it now reads back |
| `ADD COLUMN ... NOT NULL` with no default | ❌ Unsafe | Any `INSERT` from old code (which doesn't know the column exists) fails the NOT NULL constraint |
| `ALTER COLUMN ... DROP NOT NULL` → app still assumes non-null | ⚠️ Check call sites | Old code reading the column may not null-check |
| `DROP COLUMN` / `DROP TABLE` | ❌ Unsafe | Old code still selects/writes it → Prisma throws `Unknown column` |
| `RENAME COLUMN` / `RENAME TABLE` | ❌ Unsafe | Same as drop, from old code's perspective |
| New/changed `UNIQUE` or `FOREIGN KEY` constraint | ⚠️ Check call sites | Old code's write path may violate the new constraint on rows it was previously allowed to create |
| Backfill/data migration (`UPDATE ... SET`) | ⚠️ Check direction | Rolling back code doesn't undo the backfill — confirm old code tolerates the backfilled values |

If a migration mixes safe and unsafe changes (common — e.g. one migration file both adds a nullable column *and* drops an old one), treat the whole migration as unsafe.

---

## Verifying compatibility before clicking "Redeploy previous version"

1. **Identify the migration(s) that shipped with the broken deploy.** Compare `backend/prisma/migrations/` between the broken commit and the last known-good commit:
   ```bash
   git diff <last-good-sha> <broken-sha> --stat -- backend/prisma/migrations/
   ```
2. **Read every new `migration.sql` file** introduced in that diff and classify each statement against the checklist above.
3. **If all changes are additive:** open the Railway deployment list → select the last good deployment → **Rollback**. Watch the deployment logs for a "Pre-Deploy" section — if it appears and re-runs `prisma migrate deploy`, confirm it's a no-op (no pending migrations) before traffic shifts.
4. **If any change is non-additive:** do not use Rollback. Go to "Unsafe to roll back" below.
5. **Either way, after rolling back:** check `GET /health` and Sentry for the specific error that triggered the rollback to confirm it's gone, not just that the deploy succeeded.

---

## Unsafe to roll back — fix forward instead

When the schema has moved past what the old code can run against:

1. **Patch the bug directly on top of the new migration** — write the smallest possible code fix for the actual defect and deploy that, rather than reverting. This is almost always faster and safer than trying to write a compensating "down" migration under incident pressure.
2. If the bug is too large to hotfix quickly, consider a **compatibility migration**: a new forward migration that makes the schema tolerate both old and new code temporarily (e.g. make a new `NOT NULL` column nullable again, or restore a dropped column as nullable) — then deploy the *previous* app code on top of that. This is itself a deploy, not a Rollback click, and needs the same `prisma migrate deploy` pre-deploy gate to run.
3. Never manually run destructive SQL against production to "undo" a migration outside of a tracked Prisma migration file — it desyncs `_prisma_migrations` from the actual schema and breaks every future `migrate deploy`.

---

## Quick reference

| Scenario | Action |
|---|---|
| Bug is in app code only, schema unchanged | Railway Rollback — safe |
| Migration is purely additive (new nullable column/table/index) | Railway Rollback — safe |
| Migration drops/renames/tightens a constraint the old code relied on differently | **Do not roll back** — fix forward with a new migration + code patch |
| Unsure | Default to fix-forward. A bad hotfix is recoverable; a schema/code mismatch from a bad rollback can corrupt data on every write until caught |
