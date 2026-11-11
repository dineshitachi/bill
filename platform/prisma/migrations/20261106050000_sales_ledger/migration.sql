CREATE TABLE "LedgerEntry" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "invoiceNumber" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "customerDetails" TEXT NOT NULL,
  "itemizedBreakdown" TEXT NOT NULL,
  "taxTotal" DECIMAL(14,2) NOT NULL,
  "grandTotal" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LedgerEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LedgerEntry_invoiceId_key" ON "LedgerEntry"("invoiceId");
CREATE INDEX "LedgerEntry_issuedAt_idx" ON "LedgerEntry"("issuedAt");
