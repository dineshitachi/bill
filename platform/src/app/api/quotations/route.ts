import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { calculateLocalizedTax } from "@/server/tax-engine";

const quotationSchema = z.object({
  customerId: z.string().uuid().optional(), currency: z.string().trim().toUpperCase().length(3).default("INR"),
  validUntil: z.string().datetime().optional(), terms: z.string().max(5000).default(""),
  placeOfSupplyStateCode: z.string().regex(/^\d{2}$/).default("33"),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().finite().positive().max(1_000_000) })).min(1).max(100),
});

export async function GET() {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const quotations = await auth.db.$queryRaw`
    SELECT "id", "number", "customerId", "status", "version", "currency", "subtotal", "taxTotal", "total", "validUntil", "terms", "acceptedAt", "declinedAt", "createdBy", "createdAt", "updatedAt"
    FROM "Quotation" ORDER BY "createdAt" DESC LIMIT 200
  `;
  return NextResponse.json({ quotations });
}

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = quotationSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid quotation details");
  const productIds = [...new Set(parsed.data.items.map((item) => item.productId))];
  const products = await auth.db.product.findMany({ where: { id: { in: productIds } } });
  if (products.length !== productIds.length) return jsonError("One or more products were not found", 404);
  const byId = new Map(products.map((product) => [product.id, product]));
  const lines = parsed.data.items.map((item) => {
    const product = byId.get(item.productId)!;
    const gross = Math.round(item.quantity * Number(product.price) * 100) / 100;
    const tax = calculateLocalizedTax({ amount: gross, rate: Number(product.gstRate), taxType: "GST", sellerStateCode: "33", placeOfSupplyStateCode: parsed.data.placeOfSupplyStateCode });
    return { item, product, gross, taxableValue: tax.taxableValue, taxTotal: tax.taxTotal, total: tax.taxableValue + tax.taxTotal };
  });
  const subtotal = lines.reduce((sum, line) => sum + line.gross, 0);
  const taxTotal = lines.reduce((sum, line) => sum + line.taxTotal, 0);
  const total = subtotal + taxTotal;
  const id = randomUUID();
  const number = `QUO-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
  try {
    await auth.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        INSERT INTO "Quotation" ("id", "number", "customerId", "currency", "subtotal", "taxTotal", "total", "validUntil", "terms", "shareToken", "createdBy")
        VALUES (${id}::uuid, ${number}, ${parsed.data.customerId || null}::uuid, ${parsed.data.currency}, ${subtotal}, ${taxTotal}, ${total}, ${parsed.data.validUntil ? new Date(parsed.data.validUntil) : null}, ${parsed.data.terms}, ${randomBytes(24).toString("base64url")})
      `;
      for (const line of lines) {
        await tx.$executeRaw`
          INSERT INTO "QuotationItem" ("id", "quotationId", "productId", "name", "quantity", "unitPrice", "gstRate", "taxableValue", "taxTotal", "total")
          VALUES (${randomUUID()}::uuid, ${id}::uuid, ${line.product.id}::uuid, ${line.product.name}, ${line.item.quantity}, ${Number(line.product.price)}, ${Number(line.product.gstRate)}, ${line.taxableValue}, ${line.taxTotal}, ${line.total})
        `;
      }
      await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "quotation.created", subject: id, details: { number, total, currency: parsed.data.currency } } });
    });
    return NextResponse.json({ quotation: { id, number, status: "DRAFT", version: 1, currency: parsed.data.currency, subtotal, taxTotal, total } }, { status: 201 });
  } catch (error) {
    console.error("Quotation creation failed", error);
    return jsonError("Quotation could not be created", 500);
  }
}
