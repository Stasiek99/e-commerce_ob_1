-- CreateTable: invoice_corrections (faktura korygująca per Art. 106j Ustawy o VAT)
CREATE TABLE "invoice_corrections" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "correctiveInvoiceNumber" TEXT NOT NULL,
    "correctiveStoragePath" TEXT NOT NULL,
    "correctedAmountInCents" INTEGER NOT NULL,
    "refundReasonCode" TEXT NOT NULL DEFAULT 'PARTIAL_CANCELLATION',
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_corrections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoice_corrections_correctiveInvoiceNumber_key" ON "invoice_corrections"("correctiveInvoiceNumber");
CREATE INDEX "invoice_corrections_orderId_idx" ON "invoice_corrections"("orderId");

-- AddForeignKey
ALTER TABLE "invoice_corrections" ADD CONSTRAINT "invoice_corrections_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
