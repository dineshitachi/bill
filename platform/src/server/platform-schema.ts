import type { PrismaClient } from "@prisma/client";

type TenantClient = Pick<PrismaClient, "$executeRawUnsafe">;

const initialized = new WeakMap<object, Promise<void>>();

/**
 * Module tables live in each tenant schema. Keeping their DDL idempotent lets
 * the first authenticated request upgrade an existing tenant safely while
 * provisioning and deployments can run the same initializer repeatedly.
 */
export function ensurePlatformTables(db: TenantClient): Promise<void> {
  const cached = initialized.get(db);
  if (cached) return cached;
  const ready = (async () => {
    const statements = [
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customerId" UUID`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "currency" TEXT NOT NULL DEFAULT 'INR'`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "locale" TEXT NOT NULL DEFAULT 'en-IN'`,
      `CREATE INDEX IF NOT EXISTS "User_customerId_idx" ON "User"("customerId")`,
      `CREATE TABLE IF NOT EXISTS "UserPermission" (
        "id" UUID PRIMARY KEY, "userId" UUID NOT NULL, "permission" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL DEFAULT TRUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "UserPermission_userId_permission_key" UNIQUE ("userId", "permission")
      )`,
      `CREATE TABLE IF NOT EXISTS "ProductVariant" (
        "id" UUID PRIMARY KEY, "productId" UUID NOT NULL, "sku" TEXT NOT NULL UNIQUE,
        "name" TEXT NOT NULL, "attributes" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "price" DECIMAL(12,2) NOT NULL, "stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
        "lowStockAt" DECIMAL(12,3) NOT NULL DEFAULT 5, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "ProductVariant_productId_idx" ON "ProductVariant"("productId")`,
      `CREATE TABLE IF NOT EXISTS "StockMovement" (
        "id" UUID PRIMARY KEY, "productId" UUID NOT NULL, "variantId" UUID,
        "movementType" TEXT NOT NULL, "quantity" DECIMAL(12,3) NOT NULL,
        "beforeStock" DECIMAL(12,3) NOT NULL, "afterStock" DECIMAL(12,3) NOT NULL,
        "referenceType" TEXT NOT NULL DEFAULT '', "referenceId" TEXT NOT NULL DEFAULT '',
        "note" TEXT NOT NULL DEFAULT '', "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "StockMovement_productId_createdAt_idx" ON "StockMovement"("productId", "createdAt")`,
      `ALTER TABLE "StockMovement" ADD COLUMN IF NOT EXISTS "warehouseId" UUID`,
      `CREATE INDEX IF NOT EXISTS "StockMovement_warehouseId_createdAt_idx" ON "StockMovement"("warehouseId", "createdAt")`,
      `CREATE TABLE IF NOT EXISTS "Quotation" (
        "id" UUID PRIMARY KEY, "number" TEXT NOT NULL UNIQUE, "customerId" UUID,
        "status" TEXT NOT NULL DEFAULT 'DRAFT', "version" INTEGER NOT NULL DEFAULT 1,
        "currency" TEXT NOT NULL DEFAULT 'INR', "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "validUntil" TIMESTAMP(3), "terms" TEXT NOT NULL DEFAULT '', "shareToken" TEXT UNIQUE,
        "acceptedAt" TIMESTAMP(3), "declinedAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "QuotationItem" (
        "id" UUID PRIMARY KEY, "quotationId" UUID NOT NULL, "productId" UUID,
        "name" TEXT NOT NULL, "quantity" DECIMAL(12,3) NOT NULL, "unitPrice" DECIMAL(12,2) NOT NULL,
        "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 0, "taxableValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "total" DECIMAL(14,2) NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS "Quotation_customerId_createdAt_idx" ON "Quotation"("customerId", "createdAt")`,
      `CREATE TABLE IF NOT EXISTS "BillingSchedule" (
        "id" UUID PRIMARY KEY, "customerId" UUID, "name" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
        "frequency" TEXT NOT NULL, "intervalCount" INTEGER NOT NULL DEFAULT 1, "nextRunAt" TIMESTAMP(3) NOT NULL,
        "startAt" TIMESTAMP(3) NOT NULL, "endAt" TIMESTAMP(3), "currency" TEXT NOT NULL DEFAULT 'INR',
        "items" JSONB NOT NULL DEFAULT '[]'::jsonb, "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "BillingSchedule_status_nextRunAt_idx" ON "BillingSchedule"("status", "nextRunAt")`,
      `CREATE TABLE IF NOT EXISTS "BillingMilestone" (
        "id" UUID PRIMARY KEY, "customerId" UUID, "invoiceId" UUID, "name" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'PLANNED', "dueDate" TIMESTAMP(3), "amount" DECIMAL(14,2) NOT NULL,
        "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0, "currency" TEXT NOT NULL DEFAULT 'INR',
        "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "DiscountTier" (
        "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
        "minimumSubtotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "maximumSubtotal" DECIMAL(14,2),
        "percentage" DECIMAL(7,4) NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "TaxRule" (
        "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
        "taxType" TEXT NOT NULL, "rate" DECIMAL(7,4) NOT NULL, "origin" TEXT NOT NULL DEFAULT '',
        "destination" TEXT NOT NULL DEFAULT '', "nexus" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "active" BOOLEAN NOT NULL DEFAULT TRUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "CrmInteraction" (
        "id" UUID PRIMARY KEY, "customerId" UUID NOT NULL, "kind" TEXT NOT NULL,
        "subject" TEXT NOT NULL, "body" TEXT NOT NULL DEFAULT '', "dueAt" TIMESTAMP(3),
        "completedAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "CrmInteraction_customerId_dueAt_idx" ON "CrmInteraction"("customerId", "dueAt")`,
      `CREATE TABLE IF NOT EXISTS "Vendor" (
        "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT NOT NULL DEFAULT '',
        "email" TEXT NOT NULL DEFAULT '', "taxId" TEXT NOT NULL DEFAULT '', "address" TEXT NOT NULL DEFAULT '',
        "currency" TEXT NOT NULL DEFAULT 'INR', "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "PurchaseOrder" (
        "id" UUID PRIMARY KEY, "number" TEXT NOT NULL UNIQUE, "vendorId" UUID NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'DRAFT', "expectedAt" TIMESTAMP(3), "currency" TEXT NOT NULL DEFAULT 'INR',
        "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(14,2) NOT NULL DEFAULT 0, "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "PurchaseOrderItem" (
        "id" UUID PRIMARY KEY, "purchaseOrderId" UUID NOT NULL, "productId" UUID,
        "description" TEXT NOT NULL, "quantity" DECIMAL(12,3) NOT NULL, "unitPrice" DECIMAL(12,2) NOT NULL,
        "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0, "receivedQuantity" DECIMAL(12,3) NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS "Expense" (
        "id" UUID PRIMARY KEY, "category" TEXT NOT NULL, "description" TEXT NOT NULL,
        "amount" DECIMAL(14,2) NOT NULL, "currency" TEXT NOT NULL DEFAULT 'INR', "occurredAt" TIMESTAMP(3) NOT NULL,
        "vendorId" UUID, "attachmentName" TEXT NOT NULL DEFAULT '', "attachmentData" TEXT NOT NULL DEFAULT '',
        "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "Expense_occurredAt_category_idx" ON "Expense"("occurredAt", "category")`,
      `CREATE TABLE IF NOT EXISTS "DocumentAccess" (
        "id" UUID PRIMARY KEY, "documentType" TEXT NOT NULL, "documentId" UUID NOT NULL,
        "userId" UUID NOT NULL, "canView" BOOLEAN NOT NULL DEFAULT TRUE, "grantedBy" UUID NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DocumentAccess_documentType_documentId_userId_key" UNIQUE ("documentType", "documentId", "userId")
      )`,
      `CREATE INDEX IF NOT EXISTS "DocumentAccess_userId_documentType_idx" ON "DocumentAccess"("userId", "documentType")`,
      `CREATE TABLE IF NOT EXISTS "CurrencyRate" (
        "id" UUID PRIMARY KEY, "baseCurrency" TEXT NOT NULL, "currency" TEXT NOT NULL,
        "rate" DECIMAL(18,8) NOT NULL, "asOf" TIMESTAMP(3) NOT NULL, "source" TEXT NOT NULL DEFAULT 'manual',
        CONSTRAINT "CurrencyRate_baseCurrency_currency_key" UNIQUE ("baseCurrency", "currency")
      )`,
      `CREATE TABLE IF NOT EXISTS "Notification" (
        "id" UUID PRIMARY KEY, "userId" UUID, "channel" TEXT NOT NULL DEFAULT 'IN_APP',
        "kind" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL,
        "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "Notification_userId_readAt_createdAt_idx" ON "Notification"("userId", "readAt", "createdAt")`,
      `CREATE TABLE IF NOT EXISTS "AdminDiagnosticResolution" (
        "id" UUID PRIMARY KEY, "reportId" UUID NOT NULL UNIQUE, "resolvedBy" UUID NOT NULL,
        "resolutionNote" TEXT NOT NULL, "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "AdminDiagnosticResolution_resolvedAt_idx" ON "AdminDiagnosticResolution"("resolvedAt")`,
      `CREATE TABLE IF NOT EXISTS "InvoiceSequence" ("year" INTEGER PRIMARY KEY, "nextNumber" INTEGER NOT NULL DEFAULT 1)`,
      `CREATE TABLE IF NOT EXISTS "BackupRecord" (
        "id" UUID PRIMARY KEY, "status" TEXT NOT NULL DEFAULT 'COMPLETED', "format" TEXT NOT NULL DEFAULT 'JSON',
        "checksum" TEXT NOT NULL, "sizeBytes" BIGINT NOT NULL DEFAULT 0, "payload" TEXT NOT NULL,
        "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "IntegrationConnection" (
        "id" UUID PRIMARY KEY, "provider" TEXT NOT NULL, "baseUrl" TEXT NOT NULL,
        "secret" TEXT NOT NULL DEFAULT '', "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "IntegrationConnection_provider_key" UNIQUE ("provider")
      )`,
      `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarData" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "Customer" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'RETAIL'`,
      `CREATE TABLE IF NOT EXISTS "DocumentTemplate" (
        "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "documentKind" TEXT NOT NULL,
        "name" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "schema" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "source" TEXT NOT NULL DEFAULT 'BUILT_IN', "active" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "DocumentTemplate_documentKind_active_idx" ON "DocumentTemplate"("documentKind", "active")`,
      `CREATE TABLE IF NOT EXISTS "Warehouse" (
        "id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "code" TEXT NOT NULL UNIQUE,
        "address" TEXT NOT NULL DEFAULT '', "active" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "WarehouseStock" (
        "warehouseId" UUID NOT NULL, "productId" UUID NOT NULL,
        "quantity" DECIMAL(12,3) NOT NULL DEFAULT 0, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "WarehouseStock_warehouseId_productId_key" UNIQUE ("warehouseId", "productId")
      )`,
      `CREATE INDEX IF NOT EXISTS "WarehouseStock_productId_idx" ON "WarehouseStock"("productId")`,
      `CREATE TABLE IF NOT EXISTS "WarehouseTransfer" (
        "id" UUID PRIMARY KEY, "number" TEXT NOT NULL UNIQUE,
        "sourceWarehouseId" UUID NOT NULL, "targetWarehouseId" UUID NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'IN_TRANSIT', "createdBy" TEXT NOT NULL,
        "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0, "freightBasis" TEXT NOT NULL DEFAULT 'QUANTITY',
        "receivedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "receivedAt" TIMESTAMP(3)
      )`,
      `ALTER TABLE "WarehouseTransfer" ADD COLUMN IF NOT EXISTS "freightCost" DECIMAL(14,2) NOT NULL DEFAULT 0`,
      `ALTER TABLE "WarehouseTransfer" ADD COLUMN IF NOT EXISTS "freightBasis" TEXT NOT NULL DEFAULT 'QUANTITY'`,
      `CREATE INDEX IF NOT EXISTS "WarehouseTransfer_status_createdAt_idx" ON "WarehouseTransfer"("status", "createdAt")`,
      `CREATE TABLE IF NOT EXISTS "WarehouseTransferItem" (
        "id" UUID PRIMARY KEY, "transferId" UUID NOT NULL, "productId" UUID NOT NULL,
        "quantity" DECIMAL(12,3) NOT NULL, "allocatedFreight" DECIMAL(14,2) NOT NULL DEFAULT 0,
        CONSTRAINT "WarehouseTransferItem_transferId_productId_key" UNIQUE ("transferId", "productId")
      )`,
      `ALTER TABLE "WarehouseTransferItem" ADD COLUMN IF NOT EXISTS "allocatedFreight" DECIMAL(14,2) NOT NULL DEFAULT 0`,
      `CREATE INDEX IF NOT EXISTS "WarehouseTransferItem_transferId_idx" ON "WarehouseTransferItem"("transferId")`,
      `CREATE TABLE IF NOT EXISTS "RateCard" (
        "id" UUID PRIMARY KEY, "code" TEXT NOT NULL UNIQUE, "name" TEXT NOT NULL,
        "customerCategory" TEXT NOT NULL DEFAULT '', "active" BOOLEAN NOT NULL DEFAULT TRUE,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "RateCardItem" (
        "id" UUID PRIMARY KEY, "rateCardId" UUID NOT NULL, "productId" UUID NOT NULL,
        "minQuantity" DECIMAL(12,3) NOT NULL DEFAULT 1, "unitPrice" DECIMAL(14,2) NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "RateCardItem_rateCardId_productId_minQuantity_key" UNIQUE ("rateCardId", "productId", "minQuantity")
      )`,
      `CREATE TABLE IF NOT EXISTS "SalesDocument" (
        "id" UUID PRIMARY KEY, "number" TEXT NOT NULL UNIQUE, "documentKind" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'DRAFT', "customerId" UUID, "currency" TEXT NOT NULL DEFAULT 'INR',
        "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "discount" DECIMAL(14,2) NOT NULL DEFAULT 0, "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "terms" TEXT NOT NULL DEFAULT '', "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "SalesDocumentItem" (
        "id" UUID PRIMARY KEY, "salesDocumentId" UUID NOT NULL, "productId" UUID,
        "name" TEXT NOT NULL, "quantity" DECIMAL(12,3) NOT NULL, "unitPrice" DECIMAL(14,2) NOT NULL,
        "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0, "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(14,2) NOT NULL DEFAULT 0
      )`,
      `CREATE INDEX IF NOT EXISTS "SalesDocument_kind_status_idx" ON "SalesDocument"("documentKind", "status")`,
      `CREATE TABLE IF NOT EXISTS "DocumentConversion" (
        "id" UUID PRIMARY KEY, "sourceType" TEXT NOT NULL, "sourceId" UUID NOT NULL,
        "targetType" TEXT NOT NULL, "targetId" UUID NOT NULL, "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "DocumentConversion_source_target_key" UNIQUE ("sourceType", "sourceId", "targetType", "targetId")
      )`,
      `CREATE TABLE IF NOT EXISTS "CreditDebitNote" (
        "id" UUID PRIMARY KEY, "number" TEXT NOT NULL UNIQUE, "noteType" TEXT NOT NULL,
        "status" TEXT NOT NULL DEFAULT 'DRAFT', "invoiceId" UUID, "customerId" UUID,
        "warehouseId" UUID, "reason" TEXT NOT NULL, "currency" TEXT NOT NULL DEFAULT 'INR',
        "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0, "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(14,2) NOT NULL DEFAULT 0, "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "CreditDebitNoteItem" (
        "id" UUID PRIMARY KEY, "noteId" UUID NOT NULL, "productId" UUID,
        "name" TEXT NOT NULL, "quantity" DECIMAL(12,3) NOT NULL, "unitPrice" DECIMAL(14,2) NOT NULL,
        "taxRate" DECIMAL(7,4) NOT NULL DEFAULT 0, "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "total" DECIMAL(14,2) NOT NULL DEFAULT 0
      )`,
      `CREATE TABLE IF NOT EXISTS "PartyLedgerEntry" (
        "id" UUID PRIMARY KEY, "partyType" TEXT NOT NULL, "partyId" UUID NOT NULL,
        "referenceType" TEXT NOT NULL, "referenceId" TEXT NOT NULL, "referenceNumber" TEXT NOT NULL DEFAULT '',
        "debit" DECIMAL(14,2) NOT NULL DEFAULT 0, "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
        "dueDate" TIMESTAMP(3), "description" TEXT NOT NULL DEFAULT '',
        "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "PartyLedgerEntry_partyId_createdAt_idx" ON "PartyLedgerEntry"("partyType", "partyId", "createdAt")`,
      `CREATE TABLE IF NOT EXISTS "PaymentReminder" (
        "id" UUID PRIMARY KEY, "partyType" TEXT NOT NULL, "partyId" UUID NOT NULL,
        "invoiceId" UUID, "channel" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING',
        "message" TEXT NOT NULL, "sentAt" TIMESTAMP(3), "createdBy" TEXT NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "EInvoiceRecord" (
        "id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL UNIQUE, "irn" TEXT NOT NULL DEFAULT '',
        "ackNumber" TEXT NOT NULL DEFAULT '', "qrPayload" TEXT NOT NULL DEFAULT '',
        "ewayBillNumber" TEXT NOT NULL DEFAULT '', "status" TEXT NOT NULL DEFAULT 'PENDING',
        "provider" TEXT NOT NULL DEFAULT '', "response" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "EWayBillRecord" (
        "id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL UNIQUE, "ewayBillNumber" TEXT NOT NULL DEFAULT '',
        "status" TEXT NOT NULL DEFAULT 'READY', "transportMode" TEXT NOT NULL DEFAULT '',
        "approximateDistance" INTEGER NOT NULL DEFAULT 0, "vehicleNumber" TEXT NOT NULL DEFAULT '',
        "transporterId" TEXT NOT NULL DEFAULT '', "provider" TEXT NOT NULL DEFAULT '',
        "payload" JSONB NOT NULL DEFAULT '{}'::jsonb, "response" JSONB NOT NULL DEFAULT '{}'::jsonb,
        "operationId" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE INDEX IF NOT EXISTS "EWayBillRecord_status_updatedAt_idx" ON "EWayBillRecord"("status", "updatedAt")`,
    ];
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  })();
  initialized.set(db, ready);
  return ready;
}
