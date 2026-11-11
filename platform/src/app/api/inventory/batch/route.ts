import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const batchSchema = z.object({
  updates: z.array(z.object({
    productId: z.string().uuid(),
    mode: z.enum(["SET", "DELTA"]).default("DELTA"),
    quantity: z.number().finite().min(-1_000_000).max(1_000_000),
    note: z.string().trim().max(240).default(""),
  })).min(1).max(100),
});

export async function POST(request: Request) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const parsed = batchSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid stock batch");
  try {
    const movements = await auth.db.$transaction(async (tx) => {
      const result: Array<{ productId: string; beforeStock: number; afterStock: number }> = [];
      for (const update of parsed.data.updates) {
        // Lock each row before reading it so concurrent checkouts cannot oversell.
        const locked = await tx.$queryRaw<Array<{ id: string; stock: string }>>`
          SELECT "id", "stock"::text AS "stock" FROM "Product" WHERE "id" = ${update.productId}::uuid FOR UPDATE
        `;
        const current = locked[0];
        if (!current) throw new Error("One or more products were not found");
        const beforeStock = Number(current.stock);
        const afterStock = update.mode === "SET" ? update.quantity : beforeStock + update.quantity;
        if (!Number.isFinite(afterStock) || afterStock < 0) throw new Error("Stock cannot be negative");
        await tx.$executeRaw`
          UPDATE "Product" SET "stock" = ${afterStock}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${update.productId}::uuid
        `;
        await tx.$executeRaw`
          INSERT INTO "StockMovement" ("id", "productId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy")
          VALUES (${randomUUID()}::uuid, ${update.productId}::uuid, ${update.mode === "SET" ? "SET" : "ADJUSTMENT"}, ${afterStock - beforeStock}, ${beforeStock}, ${afterStock}, 'BATCH', '', ${update.note}, ${auth.session.username})
        `;
        result.push({ productId: update.productId, beforeStock, afterStock });
      }
      await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "inventory.batch.updated", subject: "batch", details: { count: result.length } } });
      return result;
    });
    return NextResponse.json({ movements });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inventory update failed";
    if (/negative|found/i.test(message)) return jsonError(message, 409);
    console.error("Inventory batch update failed", error);
    return jsonError("Inventory update failed", 500);
  }
}
