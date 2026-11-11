const { PrismaClient } = require("@prisma/client");
const { createCipheriv, createDecipheriv, randomBytes, randomUUID } = require("node:crypto");

const prisma = new PrismaClient();
const encryptionSecret = process.env.DATA_ENCRYPTION_KEY || "";
const encryptionKey = /^[0-9a-f]{64}$/i.test(encryptionSecret)
  ? Buffer.from(encryptionSecret, "hex")
  : Buffer.from(encryptionSecret, "base64");
if (encryptionKey.byteLength !== 32) throw new Error("DATA_ENCRYPTION_KEY must encode exactly 32 random bytes");

function encryptField(value) {
  if (typeof value !== "string" || !value) return value;
  if (value.startsWith("enc:v1:")) {
    const [nonceText, tagText, ciphertextText, extra] = value.slice("enc:v1:".length).split(":");
    const nonce = Buffer.from(nonceText || "", "base64url");
    const tag = Buffer.from(tagText || "", "base64url");
    const ciphertext = Buffer.from(ciphertextText || "", "base64url");
    if (
      extra === undefined &&
      nonce.byteLength === 12 &&
      tag.byteLength === 16 &&
      ciphertext.byteLength > 0 &&
      nonce.toString("base64url") === nonceText &&
      tag.toString("base64url") === tagText &&
      ciphertext.toString("base64url") === ciphertextText
    ) return value;
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `enc:v1:${nonce.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${ciphertext.toString("base64url")}`;
}

function decryptField(value) {
  if (typeof value !== "string" || !value.startsWith("enc:v1:")) return value;
  const [nonceText, tagText, ciphertextText, extra] = value.slice("enc:v1:".length).split(":");
  if (!nonceText || !tagText || !ciphertextText || extra !== undefined) throw new Error("Invalid encrypted value in tenant data");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(nonceText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function encryptTenantFields(tx, schema) {
  const tables = {
    Customer: ["name", "phone", "email", "gstin", "state", "stateCode", "address"],
    Invoice: ["customerName", "customerGstin", "sellerBrandName", "sellerLogoData", "sellerLegalName", "sellerGstin", "paymentMethod", "upiId"],
    PaymentTransaction: ["paymentMethod", "receivedBy"],
    User: ["displayName"],
    AgentTask: ["description", "screenshotData"],
  };
  for (const [table, fields] of Object.entries(tables)) {
    const selectFields = fields.map((field) => `"${field}"`).join(", ");
    const rows = await tx.$queryRawUnsafe(`SELECT "id", ${selectFields} FROM "${schema}"."${table}"`);
    const assignments = fields.map((field, index) => `"${field}" = $${index + 1}`).join(", ");
    for (const row of rows) {
      const values = fields.map((field) => encryptField(row[field]));
      if (values.some((value, index) => value !== row[fields[index]])) {
        await tx.$executeRawUnsafe(
          `UPDATE "${schema}"."${table}" SET ${assignments} WHERE "id" = $${fields.length + 1}`,
          ...values,
          row.id,
        );
      }
    }
  }
}

async function encryptPublicTenantFields() {
  const fields = ["name", "legalName", "gstin", "upiId"];
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", ${fields.map((field) => `"${field}"`).join(", ")} FROM "public"."Tenant"`,
  );
  const assignments = fields.map((field, index) => `"${field}" = $${index + 1}`).join(", ");
  for (const row of rows) {
    const values = fields.map((field) => encryptField(row[field]));
    if (values.some((value, index) => value !== row[fields[index]])) {
      await prisma.$executeRawUnsafe(
        `UPDATE "public"."Tenant" SET ${assignments} WHERE "id" = $${fields.length + 1}`,
        ...values,
        row.id,
      );
    }
  }
}

const migrations = [
  {
    name: "20261105010000_invoice_issuer_snapshot",
    statements: (schema) => [
      `ALTER TABLE "${schema}"."Invoice" ADD COLUMN IF NOT EXISTS "sellerBrandName" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "${schema}"."Invoice" ADD COLUMN IF NOT EXISTS "sellerLegalName" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "${schema}"."Invoice" ADD COLUMN IF NOT EXISTS "sellerGstin" TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "${schema}"."Invoice" ADD COLUMN IF NOT EXISTS "sellerStateCode" TEXT NOT NULL DEFAULT '33'`,
    ],
    updateLegacyInvoices: async (tx, schema, tenant) => {
      await tx.$executeRawUnsafe(
        `UPDATE "${schema}"."Invoice"
         SET "sellerBrandName" = $1, "sellerLegalName" = $2, "sellerGstin" = $3, "sellerStateCode" = $4
         WHERE "sellerLegalName" = ''`,
        tenant.name,
        tenant.legalName,
        tenant.gstin,
        tenant.stateCode,
      );
    },
  },
  {
    name: "20261106000000_payment_transactions",
    statements: (schema) => [
      `CREATE TABLE IF NOT EXISTS "${schema}"."PaymentTransaction" ("id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL REFERENCES "${schema}"."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE, "amount" DECIMAL(14,2) NOT NULL, "paymentMethod" TEXT NOT NULL, "receivedBy" TEXT NOT NULL, "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "isLegacySnapshot" BOOLEAN NOT NULL DEFAULT FALSE)`,
      `CREATE INDEX IF NOT EXISTS "PaymentTransaction_invoiceId_receivedAt_idx" ON "${schema}"."PaymentTransaction"("invoiceId", "receivedAt")`,
      `INSERT INTO "${schema}"."PaymentTransaction" ("id", "invoiceId", "amount", "paymentMethod", "receivedBy", "receivedAt", "isLegacySnapshot") SELECT md5("Invoice"."id"::text || ':opening-balance')::uuid, "Invoice"."id", "Invoice"."amountPaid", 'Opening balance snapshot', 'System migration', CURRENT_TIMESTAMP, TRUE FROM "${schema}"."Invoice" WHERE "Invoice"."amountPaid" > 0`,
    ],
  },
  {
    name: "20261106010000_agent_task_intake",
    statements: (schema) => [
      `CREATE TABLE IF NOT EXISTS "${schema}"."AgentTask" ("id" UUID PRIMARY KEY, "description" TEXT NOT NULL, "source" TEXT NOT NULL DEFAULT 'TEXT', "screenshotMime" TEXT, "screenshotData" TEXT, "createdBy" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'OPEN', "reviewedBy" TEXT, "reviewedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS "AgentTask_status_createdAt_idx" ON "${schema}"."AgentTask"("status", "createdAt")`,
    ],
  },
  {
    name: "20261106015000_company_logo",
    statements: (schema) => [
      `ALTER TABLE "${schema}"."Invoice" ADD COLUMN IF NOT EXISTS "sellerLogoData" TEXT NOT NULL DEFAULT ''`,
    ],
  },
  {
    name: "20261106020000_sensitive_field_encryption",
    statements: () => [],
    updateLegacyInvoices: encryptTenantFields,
  },
  {
    name: "20261106040000_user_theme",
    statements: (schema) => [
      `ALTER TABLE "${schema}"."User" ADD COLUMN IF NOT EXISTS "theme" TEXT NOT NULL DEFAULT 'slate'`,
    ],
  },
  {
    name: "20261106050000_sales_ledger",
    statements: (schema) => [
      `CREATE TABLE IF NOT EXISTS "${schema}"."LedgerEntry" ("id" UUID PRIMARY KEY, "invoiceId" UUID NOT NULL UNIQUE REFERENCES "${schema}"."Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE, "invoiceNumber" TEXT NOT NULL, "issuedAt" TIMESTAMP(3) NOT NULL, "customerDetails" TEXT NOT NULL, "itemizedBreakdown" TEXT NOT NULL, "taxTotal" DECIMAL(14,2) NOT NULL, "grandTotal" DECIMAL(14,2) NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS "LedgerEntry_issuedAt_idx" ON "${schema}"."LedgerEntry"("issuedAt")`,
    ],
    updateLegacyInvoices: async (tx, schema) => {
      const invoices = await tx.$queryRawUnsafe(
        `SELECT i."id", i."number", i."issuedAt", i."customerName", i."customerGstin", i."taxTotal", i."grandTotal"
         FROM "${schema}"."Invoice" i
         LEFT JOIN "${schema}"."LedgerEntry" l ON l."invoiceId" = i."id"
         WHERE i."status" = 'INVOICE' AND l."id" IS NULL`,
      );
      for (const invoice of invoices) {
        const items = await tx.$queryRawUnsafe(
          `SELECT ii."productId", p."sku", ii."name", ii."quantity", ii."unitPrice", ii."taxableValue",
                  ii."cgst", ii."sgst", ii."igst", ii."total"
           FROM "${schema}"."InvoiceItem" ii
           LEFT JOIN "${schema}"."Product" p ON p."id" = ii."productId"
           WHERE ii."invoiceId" = $1`,
          invoice.id,
        );
        const customerDetails = encryptField(JSON.stringify({
          name: decryptField(invoice.customerName),
          gstin: decryptField(invoice.customerGstin),
        }));
        const itemizedBreakdown = JSON.stringify(items.map((item) => ({
          sku: item.sku || "",
          name: item.name,
          quantity: item.quantity.toString(),
          unitPrice: item.unitPrice.toString(),
          taxableValue: item.taxableValue.toString(),
          cgst: item.cgst.toString(),
          sgst: item.sgst.toString(),
          igst: item.igst.toString(),
          total: item.total.toString(),
        })));
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schema}"."LedgerEntry"
           ("id", "invoiceId", "invoiceNumber", "issuedAt", "customerDetails", "itemizedBreakdown", "taxTotal", "grandTotal")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT ("invoiceId") DO NOTHING`,
          randomUUID(),
          invoice.id,
          invoice.number,
          invoice.issuedAt,
          customerDetails,
          itemizedBreakdown,
          invoice.taxTotal,
          invoice.grandTotal,
        );
      }
    },
  },
  {
    name: "20261110100000_agent_profiles",
    statements: (schema) => [
      `CREATE TABLE IF NOT EXISTS "${schema}"."AgentProfile" ("id" UUID PRIMARY KEY, "name" TEXT NOT NULL, "templateId" TEXT NOT NULL, "instructions" TEXT NOT NULL, "createdBy" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS "AgentProfile_createdAt_idx" ON "${schema}"."AgentProfile"("createdAt")`,
    ],
  },
];

async function main() {
  const tenants = await prisma.tenant.findMany({
    select: { id: true, slug: true, schemaName: true, name: true, legalName: true, gstin: true, stateCode: true },
  });
  for (const tenant of tenants) {
    if (!/^tenant_[a-f0-9]{32}$/.test(tenant.schemaName)) throw new Error(`Invalid schema name for tenant ${tenant.slug}`);
    const schema = tenant.schemaName;
    const invoiceTable = await prisma.$queryRawUnsafe(
      'SELECT to_regclass($1) AS "tableName"',
      `"${schema}"."Invoice"`,
    );
    if (!invoiceTable[0]?.tableName) throw new Error(`Tenant ${tenant.slug} is missing its invoice table`);

    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${schema}"."_TenantMigration" ("name" TEXT PRIMARY KEY, "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    );
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schema}"."_TenantMigration" ("name") VALUES ($1) ON CONFLICT ("name") DO NOTHING`,
      "20261105000000_initial",
    );

    for (const migration of migrations) {
      await prisma.$transaction(async (tx) => {
        const applied = await tx.$queryRawUnsafe(
          `SELECT "name" FROM "${schema}"."_TenantMigration" WHERE "name" = $1`,
          migration.name,
        );
        if (applied.length) return;
        for (const statement of migration.statements(schema)) await tx.$executeRawUnsafe(statement);
        if (migration.updateLegacyInvoices) await migration.updateLegacyInvoices(tx, schema, tenant);
        await tx.$executeRawUnsafe(
          `INSERT INTO "${schema}"."_TenantMigration" ("name") VALUES ($1)`,
          migration.name,
        );
      });
    }
  }
  await encryptPublicTenantFields();
  console.log(`Tenant schemas checked: ${tenants.length}`);
}

main()
  .catch((error) => {
    console.error("Tenant schema migration failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
