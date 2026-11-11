import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/),
  address: z.string().trim().max(500).default(""),
});

export async function GET() {
  const auth = await requirePermission("inventory.read");
  if ("response" in auth) return auth.response;
  const [warehouses, products, stock, transfers, transferItems] = await Promise.all([
    auth.db.$queryRaw<Array<{ id: string; name: string; code: string; address: string }>>`
      SELECT "id", "name", "code", "address" FROM "Warehouse" WHERE "active" = TRUE ORDER BY "name"
    `,
    auth.db.$queryRaw<Array<{ id: string; name: string; sku: string; unit: string }>>`
      SELECT "id", "name", "sku", "unit" FROM "Product" ORDER BY "name" LIMIT 2000
    `,
    auth.db.$queryRaw<Array<{ warehouseId: string; productId: string; productName: string; sku: string; unit: string; quantity: string }>>`
      SELECT s."warehouseId", s."productId", p."name" AS "productName", p."sku", p."unit", s."quantity"::text AS "quantity"
      FROM "WarehouseStock" s JOIN "Product" p ON p."id" = s."productId"
      ORDER BY p."name", s."warehouseId"
    `,
    auth.db.$queryRaw<Array<{ id: string; number: string; sourceWarehouseId: string; sourceName: string; targetWarehouseId: string; targetName: string; status: string; createdBy: string; createdAt: Date; receivedBy: string | null; receivedAt: Date | null; freightCost: string; freightBasis: string }>>`
      SELECT t."id", t."number", t."sourceWarehouseId", source."name" AS "sourceName",
        t."targetWarehouseId", target."name" AS "targetName", t."status", t."createdBy", t."createdAt", t."receivedBy", t."receivedAt",
        t."freightCost"::text AS "freightCost", t."freightBasis"
      FROM "WarehouseTransfer" t
      JOIN "Warehouse" source ON source."id" = t."sourceWarehouseId"
      JOIN "Warehouse" target ON target."id" = t."targetWarehouseId"
      ORDER BY t."createdAt" DESC LIMIT 200
    `,
    auth.db.$queryRaw<Array<{ transferId: string; productId: string; productName: string; sku: string; unit: string; quantity: string; allocatedFreight: string }>>`
      SELECT i."transferId", i."productId", p."name" AS "productName", p."sku", p."unit", i."quantity"::text AS "quantity", i."allocatedFreight"::text AS "allocatedFreight"
      FROM "WarehouseTransferItem" i JOIN "Product" p ON p."id" = i."productId"
      ORDER BY i."transferId", p."name"
    `,
  ]);
  return NextResponse.json({ warehouses, products, stock, transfers, transferItems });
}

export async function POST(request: Request) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid warehouse details");
  const id = randomUUID();
  try {
    await auth.db.$executeRaw`
      INSERT INTO "Warehouse" ("id", "name", "code", "address")
      VALUES (${id}::uuid, ${parsed.data.name}, ${parsed.data.code}, ${parsed.data.address})
    `;
    await auth.db.auditLog.create({
      data: { actorId: auth.session.userId, action: "warehouse.created", subject: id, details: { code: parsed.data.code } },
    });
    return NextResponse.json({ warehouse: { id, ...parsed.data } }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("Warehouse code already exists", 409);
    return jsonError("Warehouse could not be created", 409);
  }
}