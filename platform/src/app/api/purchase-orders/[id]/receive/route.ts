import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { randomUUID } from "node:crypto";

const schema = z.object({ items: z.array(z.object({ itemId: z.string().uuid(), quantity: z.number().positive() })).min(1).max(100) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid goods receipt");
  const { id } = await context.params;
  try {
    await auth.db.$transaction(async (tx) => {
      for (const receipt of parsed.data.items) {
        const rows = await tx.$queryRaw<Array<{ productId: string | null; quantity: string; receivedQuantity: string }>>`SELECT "productId", "quantity"::text AS "quantity", "receivedQuantity"::text AS "receivedQuantity" FROM "PurchaseOrderItem" WHERE "id" = ${receipt.itemId}::uuid AND "purchaseOrderId" = ${id}::uuid FOR UPDATE`;
        const item = rows[0];
        if (!item || !item.productId) throw new Error("Purchase order item was not found");
        if (Number(item.receivedQuantity) + receipt.quantity > Number(item.quantity)) throw new Error("Received quantity exceeds the purchase order");
        const stockRows = await tx.$queryRaw<Array<{ stock: string }>>`SELECT "stock"::text AS "stock" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR UPDATE`;
        const before = Number(stockRows[0]?.stock || 0);
        const after = before + receipt.quantity;
        await tx.$executeRaw`UPDATE "Product" SET "stock" = ${after}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${item.productId}::uuid`;
        await tx.$executeRaw`UPDATE "PurchaseOrderItem" SET "receivedQuantity" = "receivedQuantity" + ${receipt.quantity} WHERE "id" = ${receipt.itemId}::uuid`;
        await tx.$executeRaw`INSERT INTO "StockMovement" ("id", "productId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy") VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, 'PURCHASE', ${receipt.quantity}, ${before}, ${after}, 'PURCHASE_ORDER', ${id}, 'Goods received', ${auth.session.username})`;
      }
      await tx.$executeRaw`UPDATE "PurchaseOrder" SET "status" = 'RECEIVED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Goods receipt failed";
    if (/exceeds|not found/i.test(message)) return jsonError(message, 409);
    console.error("Goods receipt failed", error);
    return jsonError("Goods receipt failed", 500);
  }
}
