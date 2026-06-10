-- Fix carrier_code column type: was created as TEXT in the previous migration
-- but the schema expects the CarrierCode enum. All existing values are valid enum
-- members so the USING cast is safe.
ALTER TABLE "shipping_rates"
  ALTER COLUMN "carrier_code" TYPE "CarrierCode"
  USING "carrier_code"::"CarrierCode";

-- Add orderId FK to ReturnRequest so the refund handler can look up the Order
-- without a secondary query by orderNumber.
ALTER TABLE "return_requests" ADD COLUMN "order_id" TEXT;
ALTER TABLE "return_requests"
  ADD CONSTRAINT "return_requests_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "return_requests_order_id_idx" ON "return_requests"("order_id");
