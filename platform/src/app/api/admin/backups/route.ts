import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { prisma } from "@/server/db";

function jsonSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item: unknown) => typeof item === "bigint" ? item.toString() : item));
}

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const backups = await auth.db.$queryRaw`SELECT "id", "status", "format", "checksum", "sizeBytes"::text AS "sizeBytes", "createdBy", "createdAt" FROM "BackupRecord" ORDER BY "createdAt" DESC LIMIT 50`;
  return NextResponse.json({ backups });
}

export async function POST() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const [products, customers, invoices, invoiceItems, payments, quotations, quotationItems, vendors, purchaseOrders, purchaseOrderItems, expenses, schedules, milestones, notifications, audit, permissions, invoiceSequences] = await Promise.all([
    auth.db.$queryRaw`SELECT * FROM "Product"`, auth.db.$queryRaw`SELECT * FROM "Customer"`, auth.db.$queryRaw`SELECT * FROM "Invoice"`, auth.db.$queryRaw`SELECT * FROM "InvoiceItem"`, auth.db.$queryRaw`SELECT * FROM "PaymentTransaction"`,
    auth.db.$queryRaw`SELECT * FROM "Quotation"`, auth.db.$queryRaw`SELECT * FROM "QuotationItem"`, auth.db.$queryRaw`SELECT * FROM "Vendor"`, auth.db.$queryRaw`SELECT * FROM "PurchaseOrder"`, auth.db.$queryRaw`SELECT * FROM "PurchaseOrderItem"`,
    auth.db.$queryRaw`SELECT * FROM "Expense"`, auth.db.$queryRaw`SELECT * FROM "BillingSchedule"`, auth.db.$queryRaw`SELECT * FROM "BillingMilestone"`, auth.db.$queryRaw`SELECT * FROM "Notification"`, auth.db.$queryRaw`SELECT * FROM "AuditLog"`, auth.db.$queryRaw`SELECT * FROM "UserPermission"`, auth.db.$queryRaw`SELECT * FROM "InvoiceSequence"`,
  ]);
  const payload = JSON.stringify(jsonSafe({ version: 1, tenantId: auth.session.tenantId, createdAt: new Date().toISOString(), products, customers, invoices, invoiceItems, payments, quotations, quotationItems, vendors, purchaseOrders, purchaseOrderItems, expenses, schedules, milestones, notifications, audit, permissions, invoiceSequences }));
  const checksum = createHash("sha256").update(payload).digest("hex");
  const id = randomUUID();
  await auth.db.$executeRaw`INSERT INTO "BackupRecord" ("id", "status", "format", "checksum", "sizeBytes", "payload", "createdBy") VALUES (${id}::uuid, 'COMPLETED', 'JSON', ${checksum}, ${Buffer.byteLength(payload)}, ${payload}, ${auth.session.username})`;
  await prisma.$executeRaw`UPDATE "Tenant" SET "lastBackupAt" = CURRENT_TIMESTAMP WHERE "id" = ${auth.session.tenantId}::uuid`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "backup.created", subject: id, details: { checksum, sizeBytes: Buffer.byteLength(payload) } } });
  return NextResponse.json({ backup: { id, checksum, sizeBytes: Buffer.byteLength(payload), createdAt: new Date() } }, { status: 201 });
}
