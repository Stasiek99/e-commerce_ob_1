-- AlterTable: Payment — change onDelete from Restrict to Cascade
ALTER TABLE "payments" DROP CONSTRAINT "payments_orderId_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Shipment — change onDelete from Restrict to Cascade
ALTER TABLE "shipments" DROP CONSTRAINT "shipments_orderId_fkey";
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
