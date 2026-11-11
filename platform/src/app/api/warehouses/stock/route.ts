import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  mode: z.enum(["SET", "DELTA"]).default("SET"),
  quantity: z.number().finite().min(-1_000_000).max(1_000_000),
  note: z.string().trim().max(240).default("Opening balance"),
});

export async function POST(request: Request) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid warehouse stock adjustment");
  try {
    const movement = await auth.db.$transaction(async (tx) => {
      const location = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Warehouse" WHERE "id" = ${parsed.data.warehouseId}::uuid AND "active" = TRUE FOR SHARE`;
      const product = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Product" WHERE "id" = ${parsed.data.productId}::uuid FOR SHARE`;
      if (!location.length || !product.length) throw new Error("Warehouse or product was not found");
      await tx.$executeRaw`
        INSERT INTO "WarehouseStock" ("warehouseId", "productId", "quantity")
        VALUES (${parsed.data.warehouseId}::uuid, ${parsed.data.productId}::uuid, 0)
        ON CONFLICT ("warehouseId", "productId") DO NOTHING
      `;
      const rows = await tx.$queryRaw<Array<{ quantity: string }>>`
        SELECT "quantity"::text AS "quantity" FROM "WarehouseStock"
        WHERE "warehouseId" = ${parsed.data.warehouseId}::uuid AND "productId" = ${parsed.data.productId}::uuid FOR UPDATE
      `;
      const beforeStock = Number(rows[0]?.quantity || 0);
      const afterStock = parsed.data.mode === "SET" ? parsed.data.quantity : beforeStock + parsed.data.quantity;
      if (afterStock < 0) throw new Error("Warehouse stock cannot be negative");
      await tx.$executeRaw`
        UPDATE "WarehouseStock" SET "quantity" = ${afterStock}, "updatedAt" = CURRENT_TIMESTAMP
        WHERE "warehouseId" = ${parsed.data.warehouseId}::uuid AND "productId" = ${parsed.data.productId}::uuid
      `;
      await tx.$executeRaw`
        INSERT INTO "StockMovement" ("id", "productId", "warehouseId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy")
        VALUES (${randomUUID()}::uuid, ${parsed.data.productId}::uuid, ${parsed.data.warehouseId}::uuid,
          ${parsed.data.mode === "SET" ? "WAREHOUSE_SET" : "WAREHOUSE_ADJUSTMENT"}, ${afterStock - beforeStock}, ${beforeStock}, ${afterStock},
          'WAREHOUSE_STOCK', '', ${parsed.data.note}, ${auth.session.username})
      `;
      await tx.auditLog.create({
        data: { actorId: auth.session.userId, action: "warehouse.stock.adjusted", subject: parsed.data.warehouseId, details: { productId: parsed.data.productId, beforeStock, afterStock } },
      });
      return { warehouseId: parsed.data.warehouseId, productId: parsed.data.productId, beforeStock, afterStock };
    });
    return NextResponse.json({ movement });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Warehouse stock adjustment failed";
    if (/negative|not found/i.test(message)) return jsonError(message, 409);
    return NextResponse.json({ error: "Warehouse stock adjustment failed" }, { status: 500 });
  }
}