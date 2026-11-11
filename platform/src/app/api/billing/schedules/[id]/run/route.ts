import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { decryptCustomer, decryptTenant, encryptField } from "@/server/field-encryption";
import { jsonError } from "@/server/http";
import { calculateLocalizedTax } from "@/server/tax-engine";

function nextOccurrence(value: Date, frequency: string, interval: number): Date {
  const next = new Date(value);
  if (frequency === "WEEKLY") next.setDate(next.getDate() + 7 * interval);
  else if (frequency === "MONTHLY") next.setMonth(next.getMonth() + interval);
  else if (frequency === "QUARTERLY") next.setMonth(next.getMonth() + 3 * interval);
  else next.setFullYear(next.getFullYear() + interval);
  return next;
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.session.tenantId }, select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true } });
  if (!tenant) return jsonError("Business configuration was not found", 404);
  try {
    const result = await auth.db.$transaction(async (tx) => {
      const schedules = await tx.$queryRaw<Array<{ customerId: string | null; status: string; frequency: string; intervalCount: number; nextRunAt: Date; endAt: Date | null; currency: string; items: unknown }>>`SELECT "customerId", "status", "frequency", "intervalCount", "nextRunAt", "endAt", "currency", "items" FROM "BillingSchedule" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const schedule = schedules[0];
      if (!schedule) throw new Error("Schedule not found");
      if (schedule.status !== "ACTIVE") throw new Error("Schedule is not active");
      const rawItems = Array.isArray(schedule.items) ? schedule.items : [];
      if (!rawItems.length) throw new Error("Schedule has no billable items");
      const parsedItems = rawItems.filter((item): item is { productId: string; quantity: number; unitPrice: number; taxRate: number; prorationFactor?: number } => typeof item === "object" && item !== null && "productId" in item && typeof item.productId === "string" && typeof item.quantity === "number");
      const products = await tx.product.findMany({ where: { id: { in: parsedItems.map((item) => item.productId) } } });
      const byId = new Map(products.map((product) => [product.id, product]));
      const lines: Array<{ item: typeof parsedItems[number]; product: (typeof products)[number]; tax: ReturnType<typeof calculateLocalizedTax>; gross: number }> = [];
      for (const item of parsedItems) {
        const product = byId.get(item.productId); if (!product) throw new Error("A scheduled product no longer exists");
        const locked = await tx.$queryRaw<Array<{ stock: string }>>`SELECT "stock"::text AS "stock" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR UPDATE`;
        const stock = Number(locked[0]?.stock || 0); if (stock < item.quantity) throw new Error(`Not enough stock for ${product.name}`);
        await tx.$executeRaw`UPDATE "Product" SET "stock" = ${stock - item.quantity}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${item.productId}::uuid`;
        await tx.$executeRaw`INSERT INTO "StockMovement" ("id", "productId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy") VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, 'SALE', ${-item.quantity}, ${stock}, ${stock - item.quantity}, 'BILLING_SCHEDULE', ${id}, 'Recurring invoice', ${auth.session.username})`;
        const gross = Math.round(item.quantity * (item.unitPrice || Number(product.price)) * (item.prorationFactor || 1) * 100) / 100;
        lines.push({ item, product, gross, tax: calculateLocalizedTax({ amount: gross, rate: item.taxRate ?? Number(product.gstRate), taxType: "GST", sellerStateCode: tenant.stateCode, placeOfSupplyStateCode: tenant.stateCode }) });
      }
      const subtotal = lines.reduce((sum, line) => sum + line.gross, 0); const taxTotal = lines.reduce((sum, line) => sum + line.tax.taxTotal, 0); const total = Math.round(subtotal + taxTotal);
      const customer = schedule.customerId ? await tx.customer.findUnique({ where: { id: schedule.customerId } }) : null;
      const customerData = customer ? decryptCustomer(customer) : null; const issuer = decryptTenant(tenant); const invoiceId = randomUUID();
      const year = new Date().getFullYear();
      await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("year", "nextNumber") VALUES (${year}, 1) ON CONFLICT ("year") DO NOTHING`;
      const sequence = await tx.$queryRaw<Array<{ nextNumber: number }>>`SELECT "nextNumber" FROM "InvoiceSequence" WHERE "year" = ${year} FOR UPDATE`;
      const nextNumber = Number(sequence[0]?.nextNumber || 1);
      await tx.$executeRaw`UPDATE "InvoiceSequence" SET "nextNumber" = "nextNumber" + 1 WHERE "year" = ${year}`;
      const number = `INV-${year}-${String(nextNumber).padStart(6, "0")}`;
      await tx.$executeRaw`INSERT INTO "Invoice" ("id", "number", "customerId", "customerName", "customerGstin", "sellerBrandName", "sellerLogoData", "sellerLegalName", "sellerGstin", "sellerStateCode", "placeOfSupplyStateCode", "status", "subtotal", "discount", "taxTotal", "roundOff", "grandTotal", "amountPaid", "paymentStatus", "paymentMethod", "upiId", "theme", "createdBy") VALUES (${invoiceId}::uuid, ${number}, ${schedule.customerId || null}::uuid, ${encryptField(customerData?.name || "Walk-in customer")}, ${encryptField(customerData?.gstin || "")}, ${encryptField(issuer.name)}, ${encryptField(issuer.logoData)}, ${encryptField(issuer.legalName)}, ${encryptField(issuer.gstin)}, ${issuer.stateCode}, ${issuer.stateCode}, 'INVOICE', ${subtotal}, 0, ${taxTotal}, ${total - subtotal - taxTotal}, ${total}, 0, 'UNPAID', '', ${encryptField(issuer.upiId)}, ${issuer.theme}, ${auth.session.username})`;
      for (const line of lines) await tx.$executeRaw`INSERT INTO "InvoiceItem" ("id", "invoiceId", "productId", "name", "hsnCode", "quantity", "unitPrice", "gstRate", "taxableValue", "cgst", "sgst", "igst", "total") VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, ${line.product.id}::uuid, ${line.product.name}, ${line.product.hsnCode}, ${line.item.quantity}, ${line.item.unitPrice || Number(line.product.price)}, ${line.item.taxRate ?? Number(line.product.gstRate)}, ${line.tax.taxableValue}, 0, 0, ${line.tax.taxTotal}, ${line.tax.taxableValue + line.tax.taxTotal})`;
      const nextRunAt = nextOccurrence(schedule.nextRunAt, schedule.frequency, schedule.intervalCount); const completed = schedule.endAt !== null && nextRunAt > schedule.endAt;
      await tx.$executeRaw`INSERT INTO "LedgerEntry" ("id", "invoiceId", "invoiceNumber", "issuedAt", "customerDetails", "itemizedBreakdown", "taxTotal", "grandTotal") VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, ${number}, CURRENT_TIMESTAMP, ${encryptField(JSON.stringify(customerData || { name: "Walk-in customer" }))}, ${JSON.stringify(lines.map((line) => ({ name: line.product.name, quantity: line.item.quantity, total: line.tax.taxableValue + line.tax.taxTotal })))}, ${taxTotal}, ${total})`;
      await tx.$executeRaw`UPDATE "BillingSchedule" SET "nextRunAt" = ${nextRunAt}, "status" = ${completed ? "COMPLETED" : "ACTIVE"}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
      await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "billing.schedule.executed", subject: id, details: { invoiceId, number, nextRunAt } } });
      return { invoiceId, number, total, nextRunAt, completed };
    });
    return NextResponse.json({ run: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Recurring invoice generation failed";
    if (/not active|no billable|not found|stock|exists/i.test(message)) return jsonError(message, 409);
    console.error("Recurring invoice generation failed", error); return jsonError("Recurring invoice could not be generated", 500);
  }
}
