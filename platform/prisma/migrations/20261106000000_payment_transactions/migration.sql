CREATE TABLE "PaymentTransaction" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "amount" DECIMAL(14,2) NOT NULL,
  "paymentMethod" TEXT NOT NULL,
  "receivedBy" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "isLegacySnapshot" BOOLEAN NOT NULL DEFAULT FALSE,
  CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PaymentTransaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "PaymentTransaction_invoiceId_receivedAt_idx" ON "PaymentTransaction"("invoiceId", "receivedAt");
INSERT INTO "PaymentTransaction" ("id", "invoiceId", "amount", "paymentMethod", "receivedBy", "receivedAt", "isLegacySnapshot")
SELECT md5("Invoice"."id"::text || ':opening-balance')::uuid, "Invoice"."id", "Invoice"."amountPaid",
       'Opening balance snapshot', 'System migration', CURRENT_TIMESTAMP, TRUE
FROM "Invoice"
WHERE "Invoice"."amountPaid" > 0;
