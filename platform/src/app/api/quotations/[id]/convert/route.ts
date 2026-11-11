import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { decryptCustomer, decryptTenant, encryptField } from "@/server/field-encryption";
import { jsonError } from "@/server/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.session.tenantId }, select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true } });
  if (!tenant) return jsonError("Business configuration was not found", 404);
  const quoteRows = await auth.db.$queryRaw<Array<Record<string, unknown>>`SELECT * FROM "Quotation" WHERE "id" = ${id}::uuid FOR UPDATE`;
  const quote = quoteRows[0];
  if (!quote) return jsonError("Quotation not found", 404);
  if (quote.status !== "APPROVED" && quote.status !== "ACCEPTED") return jsonError("Only an approved quotation can become an invoice", 409);
  const items = await auth.db.$queryRaw<Array<{ productId: string; name: string; quantity: string | number; unitPrice: string | number; gstRate: string | number; taxableValue: string | number; taxTotal: string | number; total: string | number }>>`SELECT "productId", "name", "quantity", "unitPrice", "gstRate", "taxableValue", "taxTotal", "total" FROM "QuotationItem" WHERE "quotationId" = ${id}::uuid ORDER BY "id" ASC`;
  if (!items.length) return jsonError("Quotation has no items", 409);
  const customerId = typeof quote.customerId === "string" ? quote.customerId : null;
  const selectedCustomer = customerId ? await auth.db.customer.findUnique({ where: { id: customerId } }) : null;
  if (customerId && !selectedCustomer) return jsonError("Quotation customer was not found", 404);
  const products = await auth.db.product.findMany({ where: { id: { in: items.map((item) => item.productId).filter((value): value is string => Boolean(value)) } } });
  const byId = new Map(products.map((product) => [product.id, product]));
  const issuer = decryptTenant(tenant);
  try {
    const invoice = await auth.db.$transaction(async (tx) => {
      for (const item of items) {
        const product = byId.get(item.productId);
        if (!product) throw new Error("A quotation product no longer exists");
        const locked = await tx.$queryRaw<Array<{ stock: string }>>`SELECT "stock"::text AS "stock" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR UPDATE`;
        const stock = Number(locked[0]?.stock || 0);
        const quantity = Number(item.quantity);
        if (stock < quantity) throw new Error(`Not enough stock for ${product.name}`);
        await tx.$executeRaw`UPDATE "Product" SET "stock" = ${stock - quantity}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${item.productId}::uuid`;
        await tx.$executeRaw`INSERT INTO "StockMovement" ("id", "productId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy") VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, 'SALE', ${-quantity}, ${stock}, ${stock - quantity}, 'QUOTATION', ${id}, 'Quotation conversion', ${auth.session.username})`;
      }
      const year = new Date().getFullYear();
      await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("year", "nextNumber") VALUES (${year}, 1) ON CONFLICT ("year") DO NOTHING`;
      const sequence = await tx.$queryRaw<Array<{ nextNumber: number }>>`SELECT "nextNumber" FROM "InvoiceSequence" WHERE "year" = ${year} FOR UPDATE`;
      const nextNumber = Number(sequence[0]?.nextNumber || 1);
      await tx.$executeRaw`UPDATE "InvoiceSequence" SET "nextNumber" = "nextNumber" + 1 WHERE "year" = ${year}`;
      const number = `INV-${year}-${String(nextNumber).padStart(6, "0")}`;
      const subtotal = Number(quote.subtotal);
      const taxTotal = Number(quote.taxTotal);
      const total = Number(quote.total);
      await tx.$executeRaw`
        INSERT INTO "Invoice" ("id", "number", "customerId", "customerName", "customerGstin", "sellerBrandName", "sellerLogoData", "sellerLegalName", "sellerGstin", "sellerStateCode", "placeOfSupplyStateCode", "status", "subtotal", "discount", "taxTotal", "roundOff", "grandTotal", "amountPaid", "paymentStatus", "paymentMethod", "upiId", "theme", "createdBy")
        VALUES (${randomUUID()}::uuid, ${number}, ${customerId}::uuid, ${encryptField(selectedCustomer ? decryptCustomer(selectedCustomer).name : "Walk-in customer")}, ${encryptField(selectedCustomer ? decryptCustomer(selectedCustomer).gstin : "")}, ${encryptField(issuer.name)}, ${encryptField(issuer.logoData)}, ${encryptField(issuer.legalName)}, ${encryptField(issuer.gstin)}, ${issuer.stateCode}, ${issuer.stateCode}, 'INVOICE', ${subtotal}, 0, ${taxTotal}, 0, ${Math.round(total)}, 0, 'UNPAID', '', ${encryptField(issuer.upiId)}, ${issuer.theme}, ${auth.session.username})
      `;
      const invoiceRows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Invoice" WHERE "number" = ${number} LIMIT 1`;
      const invoiceId = invoiceRows[0]?.id;
      if (!invoiceId) throw new Error("Invoice could not be created");
      for (const item of items) {
        await tx.$executeRaw`INSERT INTO "InvoiceItem" ("id", "invoiceId", "productId", "name", "hsnCode", "quantity", "unitPrice", "gstRate", "taxableValue", "cgst", "sgst", "igst", "total") VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, ${item.productId}::uuid, ${item.name}, '', ${Number(item.quantity)}, ${Number(item.unitPrice)}, ${Number(item.gstRate)}, ${Number(item.taxableValue)}, 0, 0, ${Number(item.taxTotal)}, ${Number(item.total)})`;
      }
      await tx.$executeRaw`INSERT INTO "LedgerEntry" ("id", "invoiceId", "invoiceNumber", "issuedAt", "customerDetails", "itemizedBreakdown", "taxTotal", "grandTotal") VALUES (${randomUUID()}::uuid, ${invoiceId}::uuid, ${number}, CURRENT_TIMESTAMP, ${encryptField(JSON.stringify(selectedCustomer ? decryptCustomer(selectedCustomer) : { name: "Walk-in customer" }))}, ${JSON.stringify(items)}, ${taxTotal}, ${Math.round(total)})`;
      await tx.$executeRaw`UPDATE "Quotation" SET "status" = 'CONVERTED', "updatedAt" = CURRENT_TIMESTAMP, "version" = "version" + 1 WHERE "id" = ${id}::uuid`;
      await tx.$executeRaw`INSERT INTO "DocumentConversion" ("id", "sourceType", "sourceId", "targetType", "targetId", "createdBy") VALUES (${randomUUID()}::uuid, 'QUOTATION', ${id}::uuid, 'INVOICE', ${invoiceId}::uuid, ${auth.session.username})`;
      await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "quotation.converted", subject: id, details: { invoiceId, number } } });
      return { id: invoiceId, number };
    });
    return NextResponse.json({ invoice });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Quotation conversion failed";
    if (/stock|product|approved/i.test(message)) return jsonError(message, 409);
    console.error("Quotation conversion failed", error);
    return jsonError("Quotation could not be converted", 500);
  }
}
