import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ vendorId: z.string().uuid(), expectedAt: z.string().datetime().optional(), currency: z.string().trim().toUpperCase().length(3).default("INR"), items: z.array(z.object({ productId: z.string().uuid().optional(), description: z.string().trim().min(1).max(200), quantity: z.number().positive(), unitPrice: z.number().nonnegative(), taxRate: z.number().min(0).max(100).default(0) })).min(1).max(100) });

export async function GET() {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const orders = await auth.db.$queryRaw`SELECT * FROM "PurchaseOrder" ORDER BY "createdAt" DESC LIMIT 500`;
  return NextResponse.json({ orders });
}

export async function POST(request: Request) {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid purchase order");
  const id = randomUUID();
  const number = `PO-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
  const subtotal = parsed.data.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const taxTotal = parsed.data.items.reduce((sum, item) => sum + (item.quantity * item.unitPrice * item.taxRate) / 100, 0);
  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "PurchaseOrder" ("id", "number", "vendorId", "expectedAt", "currency", "subtotal", "taxTotal", "total", "createdBy") VALUES (${id}::uuid, ${number}, ${parsed.data.vendorId}::uuid, ${parsed.data.expectedAt ? new Date(parsed.data.expectedAt) : null}, ${parsed.data.currency}, ${subtotal}, ${taxTotal}, ${subtotal + taxTotal}, ${auth.session.username})`;
    for (const item of parsed.data.items) await tx.$executeRaw`INSERT INTO "PurchaseOrderItem" ("id", "purchaseOrderId", "productId", "description", "quantity", "unitPrice", "taxRate") VALUES (${randomUUID()}::uuid, ${id}::uuid, ${item.productId || null}::uuid, ${item.description}, ${item.quantity}, ${item.unitPrice}, ${item.taxRate})`;
    await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "purchase-order.created", subject: id, details: { number, total: subtotal + taxTotal } } });
  });
  return NextResponse.json({ order: { id, number, status: "DRAFT", currency: parsed.data.currency, subtotal, taxTotal, total: subtotal + taxTotal } }, { status: 201 });
}
