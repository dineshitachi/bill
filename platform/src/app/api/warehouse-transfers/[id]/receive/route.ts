import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { requirePermission } from "@/server/auth";
import { jsonError } from "@/server/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Transfer was not found", 404);
  try {
    await auth.db.$transaction(async (tx) => {
      const transfers = await tx.$queryRaw<Array<{ number: string; status: string; targetWarehouseId: string }>>`
        SELECT "number", "status", "targetWarehouseId" FROM "WarehouseTransfer" WHERE "id" = ${id}::uuid FOR UPDATE
      `;
      const transfer = transfers[0];
      if (!transfer) throw new Error("Transfer was not found");
      if (transfer.status !== "IN_TRANSIT") throw new Error("Transfer has already been received");
      const items = await tx.$queryRaw<Array<{ productId: string; quantity: string }>>`
        SELECT "productId", "quantity"::text AS "quantity" FROM "WarehouseTransferItem" WHERE "transferId" = ${id}::uuid ORDER BY "productId"
      `;
      for (const item of items) {
        const quantity = Number(item.quantity);
        const stockRows = await tx.$queryRaw<Array<{ quantity: string }>>`
          INSERT INTO "WarehouseStock" ("warehouseId", "productId", "quantity")
          VALUES (${transfer.targetWarehouseId}::uuid, ${item.productId}::uuid, ${quantity})
          ON CONFLICT ("warehouseId", "productId") DO UPDATE
            SET "quantity" = "WarehouseStock"."quantity" + EXCLUDED."quantity", "updatedAt" = CURRENT_TIMESTAMP
          RETURNING "quantity"::text AS "quantity"
        `;
        const afterStock = Number(stockRows[0]?.quantity || quantity);
        const beforeStock = afterStock - quantity;
        await tx.$executeRaw`
          INSERT INTO "StockMovement" ("id", "productId", "warehouseId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy")
          VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, ${transfer.targetWarehouseId}::uuid, 'TRANSFER_IN', ${quantity}, ${beforeStock}, ${afterStock}, 'WAREHOUSE_TRANSFER', ${id}, ${transfer.number}, ${auth.session.username})
        `;
      }
      await tx.$executeRaw`
        UPDATE "WarehouseTransfer" SET "status" = 'RECEIVED', "receivedBy" = ${auth.session.username}, "receivedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid
      `;
      await tx.auditLog.create({
        data: { actorId: auth.session.userId, action: "warehouse.transfer.received", subject: id, details: { number: transfer.number, itemCount: items.length } },
      });
    });
    return NextResponse.json({ ok: true, status: "RECEIVED" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer receipt failed";
    if (/not found|already/i.test(message)) return jsonError(message, 409);
    console.error("Warehouse transfer receipt failed", error);
    return NextResponse.json({ error: "Transfer receipt failed" }, { status: 500 });
  }
}