-- A lost dispute no longer auto-restores stock and auto-cancels the order.
-- It now lands in DISPUTE_LOST_REVIEW so an admin can confirm whether the
-- goods were actually returned before stock is incremented — most real
-- chargebacks involve goods that were genuinely delivered and aren't coming back.
ALTER TYPE "OrderStatus" ADD VALUE 'DISPUTE_LOST_REVIEW';
