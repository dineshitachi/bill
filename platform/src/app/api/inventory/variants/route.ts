import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const variantSchema = z.object({
  productId: z.string().uuid(), sku: z.string().trim().min(1).max(64), name: z.string().trim().min(1).max(120),
  attributes: z.record(z.string(), z.string()).default({}), price: z.number().finite().min(0),
  stock: z.number().finite().min(0), lowStockAt: z.number().finite().min(0).default(5),
});

export async function GET(request: Request) {
  const auth = await requirePermission("inventory.read");
  if ("response" in auth) return auth.response;
  const productId = new URL(request.url).searchParams.get("productId");
  const variants = productId
    ? await auth.db.$queryRaw`SELECT * FROM "ProductVariant" WHERE "productId" = ${productId}::uuid ORDER BY "name" ASC`
    : await auth.db.$queryRaw`SELECT * FROM "ProductVariant" ORDER BY "name" ASC`;
  return NextResponse.json({ variants });
}

export async function POST(request: Request) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const parsed = variantSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid product variation");
  try {
    const variant = await auth.db.$queryRaw`
      INSERT INTO "ProductVariant" ("id", "productId", "sku", "name", "attributes", "price", "stock", "lowStockAt")
      VALUES (${randomUUID()}::uuid, ${parsed.data.productId}::uuid, ${parsed.data.sku}, ${parsed.data.name}, ${JSON.stringify(parsed.data.attributes)}::jsonb, ${parsed.data.price}, ${parsed.data.stock}, ${parsed.data.lowStockAt})
      RETURNING *
    `;
    await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "inventory.variant.created", subject: parsed.data.productId, details: { sku: parsed.data.sku } } });
    return NextResponse.json({ variant: variant[0] }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("That variation SKU is already in use", 409);
    console.error("Variant creation failed", error);
    return jsonError("Product variation could not be created", 500);
  }
}
