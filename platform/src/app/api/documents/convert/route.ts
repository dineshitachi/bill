import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requirePermission } from "@/server/auth";
import { decryptCustomer, decryptTenant, encryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ sourceType: z.enum(["PROFORMA", "SALES_ORDER", "DELIVERY_CHALLAN"]), sourceId: z.string().uuid(), targetType: z.enum(["INVOICE", "DELIVERY_CHALLAN"]) });

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("Invalid document conversion");
  const tenant = await prisma.tenant.findUnique({ where: { id: auth.session.tenantId }, select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true } });
  if (!tenant) return jsonError("Business configuration was not found", 404);
  try {
    const result = await auth.db.$transaction(async (tx) => {
      const sourceRows = await tx.$queryRaw<Array<{ id: string; number: string; documentKind: string; status: string; customerId: string | null; currency: string; subtotal: string; taxTotal: string; total: string; terms: string }>>`SELECT "id", "number", "documentKind", "status", "customerId", "currency", "subtotal"::text AS "subtotal", "taxTotal"::text AS "taxTotal", "total"::text AS "total", "terms" FROM "SalesDocument" WHERE "id" = ${parsed.data.sourceId}::uuid AND "documentKind" = ${parsed.data.sourceType} FOR UPDATE`;
      const source = sourceRows[0]; if (!source) throw new Error("Source document not found"); if (source.status === "CONVERTED") throw new Error("Source document is already converted");
      const items = await tx.$queryRaw<Array<{ productId: string | null; name: string; quantity: string; unitPrice: string; taxRate: string; taxTotal: string; total: string }>>`SELECT "productId", "name", "quantity"::text AS "quantity", "unitPrice"::text AS "unitPrice", "taxRate"::text AS "taxRate", "taxTotal"::text AS "taxTotal", "total"::text AS "total" FROM "SalesDocumentItem" WHERE "salesDocumentId" = ${parsed.data.sourceId}::uuid`;
      if (!items.length) throw new Error("Source document has no items");
      const targetId = randomUUID();
      if (parsed.data.targetType === "DELIVERY_CHALLAN") {
        const targetNumber = `DC-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`;
        await tx.$executeRaw`INSERT INTO "SalesDocument" ("id", "number", "documentKind", "status", "customerId", "currency", "subtotal", "taxTotal", "total", "terms", "createdBy") VALUES (${targetId}::uuid, ${targetNumber}, 'DELIVERY_CHALLAN', 'ISSUED', ${source.customerId || null}::uuid, ${source.currency}, ${Number(source.subtotal)}, ${Number(source.taxTotal)}, ${Number(source.total)}, ${source.terms}, ${auth.session.username})`;
        for (const item of items) await tx.$executeRaw`INSERT INTO "SalesDocumentItem" ("id", "salesDocumentId", "productId", "name", "quantity", "unitPrice", "taxRate", "taxTotal", "total") VALUES (${randomUUID()}::uuid, ${targetId}::uuid, ${item.productId || null}::uuid, ${item.name}, ${Number(item.quantity)}, ${Number(item.unitPrice)}, ${Number(item.taxRate)}, ${Number(item.taxTotal)}, ${Number(item.total)})`;
        await tx.$executeRaw`INSERT INTO "DocumentConversion" ("id", "sourceType", "sourceId", "targetType", "targetId", "createdBy") VALUES (${randomUUID()}::uuid, ${parsed.data.sourceType}, ${parsed.data.sourceId}::uuid, 'DELIVERY_CHALLAN', ${targetId}::uuid, ${auth.session.username})`;
        await tx.$executeRaw`UPDATE "SalesDocument" SET "status" = 'CONVERTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${parsed.data.sourceId}::uuid`;
        return { targetId, targetNumber, targetType: "DELIVERY_CHALLAN" };
      }
      const issuer = decryptTenant(tenant); const customer = source.customerId ? await tx.customer.findUnique({ where: { id: source.customerId } }) : null; const customerData = customer ? decryptCustomer(customer) : null; const year = new Date().getFullYear();
      await tx.$executeRaw`INSERT INTO "InvoiceSequence" ("year", "nextNumber") VALUES (${year}, 1) ON CONFLICT ("year") DO NOTHING`;
      const sequence = await tx.$queryRaw<Array<{ nextNumber: number }>>`SELECT "nextNumber" FROM "InvoiceSequence" WHERE "year" = ${year} FOR UPDATE`; const nextNumber = Number(sequence[0]?.nextNumber || 1); await tx.$executeRaw`UPDATE "InvoiceSequence" SET "nextNumber" = "nextNumber" + 1 WHERE "year" = ${year}`;
      const number = `INV-${year}-${String(nextNumber).padStart(6, "0")}`;
      for (const item of items) if (item.productId) { const stockRows = await tx.$queryRaw<Array<{ stock: string }>>`SELECT "stock"::text AS "stock" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR UPDATE`; const stock = Number(stockRows[0]?.stock || 0); const quantity = Number(item.quantity); if (stock < quantity) throw new Error(`Not enough stock for ${item.name}`); await tx.$executeRaw`UPDATE "Product" SET "stock" = ${stock - quantity}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${item.productId}::uuid`; await tx.$executeRaw`INSERT INTO "StockMovement" ("id", "productId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy") VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, 'SALE', ${-quantity}, ${stock}, ${stock - quantity}, 'DOCUMENT_CONVERSION', ${parsed.data.sourceId}, 'Sales document converted to invoice', ${auth.session.username})`; }
      await tx.$executeRaw`INSERT INTO "Invoice" ("id", "number", "customerId", "customerName", "customerGstin", "sellerBrandName", "sellerLogoData", "sellerLegalName", "sellerGstin", "sellerStateCode", "placeOfSupplyStateCode", "status", "subtotal", "discount", "taxTotal", "roundOff", "grandTotal", "amountPaid", "paymentStatus", "paymentMethod", "upiId", "theme", "createdBy") VALUES (${targetId}::uuid, ${number}, ${source.customerId || null}::uuid, ${encryptField(customerData?.name || "Walk-in customer")}, ${encryptField(customerData?.gstin || "")}, ${encryptField(issuer.name)}, ${encryptField(issuer.logoData)}, ${encryptField(issuer.legalName)}, ${encryptField(issuer.gstin)}, ${issuer.stateCode}, ${issuer.stateCode}, 'INVOICE', ${Number(source.subtotal)}, 0, ${Number(source.taxTotal)}, 0, ${Math.round(Number(source.total))}, 0, 'UNPAID', '', ${encryptField(issuer.upiId)}, ${issuer.theme}, ${auth.session.username})`;
      for (const item of items) await tx.$executeRaw`INSERT INTO "InvoiceItem" ("id", "invoiceId", "productId", "name", "hsnCode", "quantity", "unitPrice", "gstRate", "taxableValue", "cgst", "sgst", "igst", "total") VALUES (${randomUUID()}::uuid, ${targetId}::uuid, ${item.productId || null}::uuid, ${item.name}, '', ${Number(item.quantity)}, ${Number(item.unitPrice)}, ${Number(item.taxRate)}, ${Number(item.total) - Number(item.taxTotal)}, 0, 0, ${Number(item.taxTotal)}, ${Number(item.total)})`;
      await tx.$executeRaw`INSERT INTO "LedgerEntry" ("id", "invoiceId", "invoiceNumber", "issuedAt", "customerDetails", "itemizedBreakdown", "taxTotal", "grandTotal") VALUES (${randomUUID()}::uuid, ${targetId}::uuid, ${number}, CURRENT_TIMESTAMP, ${encryptField(JSON.stringify(customerData || { name: "Walk-in customer" }))}, ${JSON.stringify(items)}, ${Number(source.taxTotal)}, ${Math.round(Number(source.total))})`;
      if (source.customerId) await tx.$executeRaw`INSERT INTO "PartyLedgerEntry" ("id", "partyType", "partyId", "referenceType", "referenceId", "referenceNumber", "debit", "credit", "description", "createdBy") VALUES (${randomUUID()}::uuid, 'CUSTOMER', ${source.customerId}::uuid, 'INVOICE', ${targetId}, ${number}, ${Math.round(Number(source.total))}, 0, 'Converted sales document', ${auth.session.username})`;
      await tx.$executeRaw`INSERT INTO "DocumentConversion" ("id", "sourceType", "sourceId", "targetType", "targetId", "createdBy") VALUES (${randomUUID()}::uuid, ${parsed.data.sourceType}, ${parsed.data.sourceId}::uuid, 'INVOICE', ${targetId}::uuid, ${auth.session.username})`;
      await tx.$executeRaw`UPDATE "SalesDocument" SET "status" = 'CONVERTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${parsed.data.sourceId}::uuid`;
      return { targetId, targetNumber: number, targetType: "INVOICE" };
    });
    return NextResponse.json({ conversion: result }, { status: 201 });
  } catch (error) { const message = error instanceof Error ? error.message : "Document conversion failed"; if (/not found|already|stock|items/i.test(message)) return jsonError(message, 409); console.error("Document conversion failed", error); return jsonError("Document conversion failed", 500); }
}
