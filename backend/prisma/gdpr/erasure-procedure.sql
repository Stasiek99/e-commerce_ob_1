-- GDPR Art. 17 — Right to erasure ("right to be forgotten")
-- Run manually by an operator when a verified erasure request is received.
--
-- Usage (psql):
--   psql $DIRECT_URL -v user_id="'<uuid>'" -f erasure-procedure.sql
--
-- Before running:
--   1. Verify the erasure request is legitimate (identity check via email/phone).
--   2. Confirm no open orders (PENDING_PAYMENT, PAID, PROCESSING) exist for the user.
--      Orders in those states must be resolved first (cancel / refund).
--   3. Log the request and the operator who executed this script (audit trail).
--
-- What this script does:
--   * Anonymises the user row — cannot be linked back to a natural person.
--   * Deletes all auth tokens, verification tokens, addresses.
--   * Anonymises order snapshots (legal 5-year retention period keeps the rows).
--   * Does NOT delete order/payment/shipment rows — required for accounting / tax law
--     (ustawa o rachunkowości Art. 74, ordynacja podatkowa Art. 86).
--
-- Idempotent — safe to run twice (email already anonymised → WHERE clause no-ops).

BEGIN;

-- ── 1. Revoke all sessions and tokens ────────────────────────────────────────
DELETE FROM refresh_tokens               WHERE "userId" = :user_id;
DELETE FROM email_verification_tokens    WHERE "userId" = :user_id;
DELETE FROM password_reset_tokens        WHERE "userId" = :user_id;

-- ── 2. Remove addresses ───────────────────────────────────────────────────────
DELETE FROM addresses WHERE "userId" = :user_id;

-- ── 3. Anonymise order snapshots (keep rows for tax/accounting) ───────────────
UPDATE orders SET
  "snapshotFirstName"  = 'DELETED',
  "snapshotLastName"   = 'DELETED',
  "snapshotEmail"      = 'deleted_' || id || '@erasure.invalid',
  "snapshotPhone"      = 'DELETED',
  "snapshotCompany"    = NULL,
  "snapshotNip"        = NULL,
  "updatedAt"          = now()
WHERE "userId" = :user_id;

-- ── 4. Anonymise the user row itself ─────────────────────────────────────────
UPDATE users SET
  email            = 'deleted_' || id || '@erasure.invalid',
  "passwordHash"   = NULL,
  "firstName"      = NULL,
  "lastName"       = NULL,
  phone            = NULL,
  "googleId"       = NULL,
  nip              = NULL,
  "isEmailVerified" = false,
  "updatedAt"      = now()
WHERE id = :user_id;

COMMIT;

-- After running, verify:
--   SELECT id, email, "firstName", "passwordHash" FROM users WHERE id = :user_id;
--   SELECT id, "snapshotEmail", "snapshotFirstName" FROM orders WHERE "userId" = :user_id;
