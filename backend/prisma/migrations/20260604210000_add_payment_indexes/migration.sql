-- Composite index for reconcilePendingPayments() which filters by status + createdAt.
-- Covers: WHERE status = 'PENDING' AND createdAt < $cutoff AND stripeCheckoutSessionId IS NOT NULL
CREATE INDEX IF NOT EXISTS "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- Lookup by Stripe checkout session ID (used in webhook handler and reconciliation).
CREATE INDEX IF NOT EXISTS "payments_stripeCheckoutSessionId_idx" ON "payments"("stripeCheckoutSessionId");
