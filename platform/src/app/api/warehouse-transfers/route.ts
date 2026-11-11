import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { allocateFreightCents, type FreightAllocationBasis } from "@/server/freight-allocation";

const schema = z.object({
  sourceWarehouseId: z.string().uuid(),
  targetWarehouseId: z.string().uuid(),
  freightCost: z.number().finite().min(0).max(1_000_000_000).default(0),
  freightBasis: z.enum(["QUANTITY", "CATALOG_VALUE"]).default("QUANTITY"),
  items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().finite().positive().max(1_000_000) })).min(1).max(100),
}).refine((value) => value.sourceWarehouseId !== value.targetWarehouseId, "Source and destination must differ")
  .refine((value) => new Set(value.items.map((item) => item.productId)).size === value.items.length, "Each product may only appear once");

export async function POST(request: Request) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid warehouse transfer");
  const transferId = randomUUID();
  const number = `TRF-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`;
  const sortedItems = [...parsed.data.items].sort((a, b) => a.productId.localeCompare(b.productId));

  try {
    const allocations = await auth.db.$transaction(async (tx) => {
      const warehouseIds = [parsed.data.sourceWarehouseId, parsed.data.targetWarehouseId].sort();
      for (const warehouseId of warehouseIds) {
        const warehouse = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Warehouse" WHERE "id" = ${warehouseId}::uuid AND "active" = TRUE FOR SHARE`;
        if (!warehouse.length) throw new Error("An active source or destination warehouse was not found");
      }
      const freightWeights: number[] = [];
      for (const item of sortedItems) {
        const products = await tx.$queryRaw<Array<{ price: string }>>`
          SELECT "price"::text AS "price" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR SHARE
        `;
        if (!products.length) throw new Error("One or more products were not found");
        const lineValue = Number(products[0].price) * item.quantity;
        freightWeights.push(parsed.data.freightBasis === "QUANTITY" ? item.quantity : lineValue);
      }
      const allocatedFreight = allocateFreightCents(parsed.data.freightCost, freightWeights).map((cents) => cents / 100);
      await tx.$executeRaw`
        INSERT INTO "WarehouseTransfer" ("id", "number", "sourceWarehouseId", "targetWarehouseId", "status", "createdBy", "freightCost", "freightBasis")
        VALUES (${transferId}::uuid, ${number}, ${parsed.data.sourceWarehouseId}::uuid, ${parsed.data.targetWarehouseId}::uuid, 'IN_TRANSIT', ${auth.session.username}, ${parsed.data.freightCost}, ${parsed.data.freightBasis})
      `;
      for (const [index, item] of sortedItems.entries()) {
        const stockRows = await tx.$queryRaw<Array<{ quantity: string }>>`
          SELECT "quantity"::text AS "quantity" FROM "WarehouseStock"
          WHERE "warehouseId" = ${parsed.data.sourceWarehouseId}::uuid AND "productId" = ${item.productId}::uuid FOR UPDATE
        `;
        const beforeStock = Number(stockRows[0]?.quantity || 0);
        if (!stockRows.length || beforeStock < item.quantity) throw new Error("Insufficient stock at the source warehouse");
        const afterStock = beforeStock - item.quantity;
        await tx.$executeRaw`
          UPDATE "WarehouseStock" SET "quantity" = ${afterStock}, "updatedAt" = CURRENT_TIMESTAMP
          WHERE "warehouseId" = ${parsed.data.sourceWarehouseId}::uuid AND "productId" = ${item.productId}::uuid
        `;
        await tx.$executeRaw`
          INSERT INTO "WarehouseTransferItem" ("id", "transferId", "productId", "quantity", "allocatedFreight")
          VALUES (${randomUUID()}::uuid, ${transferId}::uuid, ${item.productId}::uuid, ${item.quantity}, ${allocatedFreight[index]})
        `;
        await tx.$executeRaw`
          INSERT INTO "StockMovement" ("id", "productId", "warehouseId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy")
          VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, ${parsed.data.sourceWarehouseId}::uuid, 'TRANSFER_OUT', ${-item.quantity}, ${beforeStock}, ${afterStock}, 'WAREHOUSE_TRANSFER', ${transferId}, ${number}, ${auth.session.username})
        `;
      }
      await tx.auditLog.create({
        data: { actorId: auth.session.userId, action: "warehouse.transfer.dispatched", subject: transferId, details: { number, sourceWarehouseId: parsed.data.sourceWarehouseId, targetWarehouseId: parsed.data.targetWarehouseId, itemCount: parsed.data.items.length, freightCost: parsed.data.freightCost, freightBasis: parsed.data.freightBasis } },
      });
      return allocatedFreight;
    });
    const freightByProduct = sortedItems.map((item, index) => ({ productId: item.productId, allocatedFreight: allocations[index] }));
    return NextResponse.json({ transfer: { id: transferId, number, status: "IN_TRANSIT", freightCost: parsed.data.freightCost, freightBasis: parsed.data.freightBasis as FreightAllocationBasis, freightByProduct } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transfer could not be dispatched";
    if (/stock|warehouse/i.test(message)) return jsonError(message, 409);
    return NextResponse.json({ error: "Transfer could not be dispatched" }, { status: 500 });
  }
}