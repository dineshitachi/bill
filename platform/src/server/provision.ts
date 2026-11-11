import { randomBytes, createHash, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma, tenantDb } from "@/server/db";
import { decryptTenant, encryptField } from "@/server/field-encryption";
import { ensurePlatformTables } from "@/server/platform-schema";

const schemaStatements = (schema: string) => {
  if (!/^tenant_[a-f0-9]{32}$/.test(schema)) throw new Error("Invalid generated tenant schema");
  const t = `"${schema}"`;
  return [
    `CREATE TABLE ${t}."User" ("id" UUID PRIMARY KEY, "username" TEXT NOT NULL UNIQUE, "displayName" TEXT NOT NULL, "passwordHash" TEXT NOT NULL, "role" TEXT NOT NULL DEFAULT 'SALES', "theme" TEXT NOT NULL DEFAULT 'slate', "currency" TEXT NOT NULL DEFAULT 'INR', "locale" TEXT NOT NULL DEFAULT 'en-IN', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "disabledAt" TIMESTAMP(3), "customerId" UUID)`,
    `CREATE TABLE ${t}."Product" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "sku" TEXT NOT NULL UNIQUE, "unit" TEXT NOT NULL DEFAULT 'pcs', "price" DECIMAL(12,2) NOT NULL, "stock" DECIMAL(12,3) NOT NULL, "lowStockAt" DECIMAL(12,3) NOT NULL DEFAULT 5, "gstRate" DECIMAL(5,2) NOT NULL DEFAULT 18, "hsnCode" TEXT NOT NULL DEFAULT '', "updatedAt" TIMESTAMP(3) NOT NULL)`,
    `CREATE TABLE ${t}."Customer" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "phone" TEXT NOT NULL DEFAULT '', "email" TEXT NOT NULL DEFAULT '', "gstin" TEXT NOT NULL DEFAULT '', "state" TEXT NOT NULL DEFAULT '', "stateCode" TEXT NOT NULL DEFAULT '33', "address" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE ${t}."Invoice" ("id" UUID PRIMARY KEY, "number" TEXT NOT NULL UNIQUE, "customerId" UUID, "customerName" TEXT NOT NULL, "customerGstin" TEXT NOT NULL DEFAULT '', "sellerBrandName" TEXT NOT NULL DEFAULT '', "sellerLogoData" TEXT NOT NULL DEFAULT '', "sellerLegalName" TEXT NOT NULL DEFAULT '', "sellerGstin" TEXT NOT NULL DEFAULT '', "sellerStateCode" TEXT NOT NULL DEFAULT '33', "placeOfSupplyStateCode" TEXT NOT NULL DEFAULT '33', "status" TEXT NOT NULL DEFAULT 'INVOICE', "subtotal" DECIMAL(14,2) NOT NULL, "discount" DECIMAL(14,2) NOT NULL DEFAULT 0, "taxTotal" DECIMAL(14,2) NOT NULL, "roundOff" DECIMAL(14,2) NOT NULL DEFAULT 0, "grandTotal" DECIMAL(14,2) NOT NULL, "amountPaid" DECIMAL(14,2) NOT NULL DEFAULT 0, "paymentStatus" TEXT NOT NULL DEFAULT 'UNPAID', "paymentMethod" TEXT NOT NULL DEFAULT '', "upiId" TEXT NOT NULL DEFAULT '', "theme" TEXT NOT NULL DEFAULT 'luxe', "createdBy" TEXT NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE ${t}."PaymentTransaction" ("id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL REFERENCES ${t}."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE, "amount" DECIMAL(14,2) NOT NULL, "paymentMethod" TEXT NOT NULL, "receivedBy" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "isLegacySnapshot" BOOLEAN NOT NULL DEFAULT FALSE)`,
    `CREATE INDEX "PaymentTransaction_invoiceId_receivedAt_idx" ON ${t}."PaymentTransaction"("invoiceId", "receivedAt")`,
    `CREATE TABLE ${t}."InvoiceItem" ("id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL REFERENCES ${t}."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE, "productId" UUID, "name" TEXT NOT NULL, "hsnCode" TEXT NOT NULL DEFAULT '', "quantity" DECIMAL(12,3) NOT NULL, "unitPrice" DECIMAL(12,2) NOT NULL, "gstRate" DECIMAL(5,2) NOT NULL, "taxableValue" DECIMAL(14,2) NOT NULL, "cgst" DECIMAL(14,2) NOT NULL DEFAULT 0, "sgst" DECIMAL(14,2) NOT NULL DEFAULT 0, "igst" DECIMAL(14,2) NOT NULL DEFAULT 0, "total" DECIMAL(14,2) NOT NULL)`,
    `CREATE TABLE ${t}."LedgerEntry" ("id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL UNIQUE REFERENCES ${t}."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE, "invoiceNumber" TEXT NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL, "customerDetails" TEXT NOT NULL, "itemizedBreakdown" TEXT NOT NULL, "taxTotal" DECIMAL(14,2) NOT NULL, "grandTotal" DECIMAL(14,2) NOT NULL)`,
    `CREATE INDEX "LedgerEntry_issuedAt_idx" ON ${t}."LedgerEntry"("issuedAt")`,
    `CREATE TABLE ${t}."AuditLog" ("id" UUID PRIMARY KEY, "actorId" TEXT NOT NULL, "action" TEXT NOT NULL, "subject" TEXT NOT NULL, "details" JSONB NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE ${t}."AgentErrorReport" ("id" UUID PRIMARY KEY, "userId" TEXT, "fingerprint" TEXT NOT NULL, "name" TEXT NOT NULL, "message" TEXT NOT NULL, "route" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "count" INTEGER NOT NULL DEFAULT 1)`,
    `CREATE TABLE ${t}."AgentTask" ("id" UUID PRIMARY KEY, "description" TEXT NOT NULL, "source" TEXT NOT NULL DEFAULT 'TEXT', "screenshotMime" TEXT, "screenshotData" TEXT, "createdBy" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)`,
    `CREATE INDEX "AgentTask_status_createdAt_idx" ON ${t}."AgentTask"("status", "createdAt")`,
    `CREATE TABLE ${t}."AgentProfile" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "templateId" TEXT NOT NULL, "instructions" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)`,
    `CREATE INDEX "AgentProfile_createdAt_idx" ON ${t}."AgentProfile"("createdAt")`,
    `CREATE TABLE ${t}."_TenantMigration" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  ];
};

export async function provisionTenant(input: {
  name: string;
  slug: string;
  adminUsername: string;
  adminDisplayName: string;
  adminPassword: string;
  legalName?: string;
  stateCode?: string;
}) {
  const schemaName = `tenant_${randomUUID().replaceAll("-", "")}`;
  const apiKey = `nbp_${randomBytes(32).toString("base64url")}`;
  const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");
  const passwordHash = await bcrypt.hash(input.adminPassword, 12);

  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schemaName}"`);
  try {
    for (const statement of schemaStatements(schemaName)) await prisma.$executeRawUnsafe(statement);
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}"."_TenantMigration" ("name") VALUES ($1)`,
      "20261105000000_initial",
    );
    const db = tenantDb(schemaName);
    const adminUserId = randomUUID();
    await db.user.create({
      data: {
        id: adminUserId,
        username: input.adminUsername,
        displayName: encryptField(input.adminDisplayName),
        passwordHash,
        role: "ADMIN",
      },
    });
    const tenant = await prisma.tenant.create({
      data: {
        name: encryptField(input.name),
        slug: input.slug,
        schemaName,
        apiKeyHash,
        legalName: encryptField(input.legalName || "Chinnathambi Traders"),
        gstin: encryptField(""),
        upiId: encryptField(""),
        stateCode: input.stateCode || "33",
      },
      select: { id: true, name: true, legalName: true, gstin: true, upiId: true, slug: true, schemaName: true },
    });
    await prisma.$executeRaw`UPDATE "Tenant" SET "onboardingState" = 'TRIAL', "subscriptionStatus" = 'TRIAL', "planCode" = 'TRIAL', "trialStartedAt" = CURRENT_TIMESTAMP, "trialEndsAt" = CURRENT_TIMESTAMP + INTERVAL '14 days', "maxUsers" = 3, "maxProducts" = 50, "maxInvoicesPerMonth" = 100 WHERE "id" = ${tenant.id}::uuid`;
    await prisma.$executeRaw`INSERT INTO "BusinessMembership" ("id", "userId", "tenantId", "role") VALUES (${randomUUID()}::uuid, ${adminUserId}::uuid, ${tenant.id}::uuid, 'ADMIN') ON CONFLICT ("userId", "tenantId") DO NOTHING`;
    await ensurePlatformTables(db);
    await db.product.createMany({ data: [
      { id: randomUUID(), name: "Demo Copper Wire", sku: "DEMO-WIRE-01", unit: "roll", price: 1250, stock: 25, lowStockAt: 5, gstRate: 18, hsnCode: "8544" },
      { id: randomUUID(), name: "Demo LED Panel", sku: "DEMO-LED-01", unit: "pcs", price: 850, stock: 18, lowStockAt: 4, gstRate: 18, hsnCode: "9405" },
    ] });
    await db.customer.create({ data: { id: randomUUID(), name: encryptField("Demo Customer"), phone: encryptField("9876543210"), email: encryptField("demo@example.com"), gstin: encryptField(""), state: encryptField("Tamil Nadu"), stateCode: encryptField("33"), address: encryptField("Demo address") } });
    return { tenant: decryptTenant(tenant), apiKey };
  } catch (error) {
    await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    throw error;
  }
}
