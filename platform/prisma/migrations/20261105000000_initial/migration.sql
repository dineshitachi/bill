CREATE TABLE "Tenant" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "schemaName" TEXT NOT NULL,
  "apiKeyHash" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "maintenanceMode" BOOLEAN NOT NULL DEFAULT FALSE,
  "legalName" TEXT NOT NULL DEFAULT 'Chinnathambi Traders',
  "gstin" TEXT NOT NULL DEFAULT '',
  "stateCode" TEXT NOT NULL DEFAULT '33',
  "upiId" TEXT NOT NULL DEFAULT '',
  "theme" TEXT NOT NULL DEFAULT 'luxe',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");
CREATE UNIQUE INDEX "Tenant_schemaName_key" ON "Tenant"("schemaName");
CREATE UNIQUE INDEX "Tenant_apiKeyHash_key" ON "Tenant"("apiKeyHash");
CREATE TABLE "TenantNode" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "nodeId" TEXT NOT NULL,
  "clientVersion" TEXT NOT NULL,
  "operatingSystem" TEXT NOT NULL,
  "device" TEXT NOT NULL,
  "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activeSessions" INTEGER NOT NULL DEFAULT 0,
  "storageBytes" BIGINT NOT NULL DEFAULT 0,
  "transactionsToday" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "TenantNode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TenantNode_tenantId_nodeId_key" ON "TenantNode"("tenantId", "nodeId");

CREATE TABLE "User" (
  "id" UUID NOT NULL,
  "username" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'STAFF',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "disabledAt" TIMESTAMP(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE TABLE "Product" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "sku" TEXT NOT NULL,
  "unit" TEXT NOT NULL DEFAULT 'pcs',
  "price" DECIMAL(12,2) NOT NULL,
  "stock" DECIMAL(12,3) NOT NULL,
  "lowStockAt" DECIMAL(12,3) NOT NULL DEFAULT 5,
  "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 18,
  "hsnCode" TEXT NOT NULL DEFAULT '',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Product_sku_key" ON "Product"("sku");
CREATE TABLE "Customer" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "phone" TEXT NOT NULL DEFAULT '',
  "email" TEXT NOT NULL DEFAULT '',
  "gstin" TEXT NOT NULL DEFAULT '',
  "state" TEXT NOT NULL DEFAULT '',
  "stateCode" TEXT NOT NULL DEFAULT '33',
  "address" TEXT NOT NULL DEFAULT '',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Invoice" (
  "id" UUID NOT NULL,
  "number" TEXT NOT NULL,
  "customerId" UUID,
  "customerName" TEXT NOT NULL,
  "customerGstin" TEXT NOT NULL DEFAULT '',
  "sellerBrandName" TEXT NOT NULL DEFAULT '',
  "sellerLegalName" TEXT NOT NULL DEFAULT '',
  "sellerGstin" TEXT NOT NULL DEFAULT '',
  "sellerStateCode" TEXT NOT NULL DEFAULT '33',
  "placeOfSupplyStateCode" TEXT NOT NULL DEFAULT '33',
  "status" TEXT NOT NULL DEFAULT 'INVOICE',
  "subtotal" DECIMAL(14,2) NOT NULL,
  "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "taxTotal" DECIMAL(14,2) NOT NULL,
  "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "grandTotal" DECIMAL(14,2) NOT NULL,
  "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID',
  "paymentMethod" TEXT NOT NULL DEFAULT '',
  "upiId" TEXT NOT NULL DEFAULT '',
  "theme" TEXT NOT NULL DEFAULT 'luxe',
  "createdBy" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");
CREATE TABLE "InvoiceItem" (
  "id" UUID NOT NULL,
  "invoiceId" UUID NOT NULL,
  "productId" UUID,
  "name" TEXT NOT NULL,
  "hsnCode" TEXT NOT NULL DEFAULT '',
  "quantity" DECIMAL(12,3) NOT NULL,
  "unitPrice" DECIMAL(12,2) NOT NULL,
  "gstRate" DECIMAL(5,2) NOT NULL,
  "taxableValue" DECIMAL(14,2) NOT NULL,
  "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "igst" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "total" DECIMAL(14,2) NOT NULL,
  CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "AuditLog" (
  "id" UUID NOT NULL,
  "actorId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "details" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AgentErrorReport" (
  "id" UUID NOT NULL,
  "userId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "count" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "AgentErrorReport_pkey" PRIMARY KEY ("id")
);
