import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ name: z.string().trim().min(1).max(120).optional(), attributes: z.record(z.string(), z.string()).optional(), price: z.number().finite().min(0).optional(), stock: z.number().finite().min(0).optional(), lowStockAt: z.number().finite().min(0).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid product variation update");
  const result = await auth.db.$executeRaw`UPDATE "ProductVariant" SET "name" = COALESCE(${parsed.data.name || null}, "name"), "attributes" = COALESCE(${parsed.data.attributes ? JSON.stringify(parsed.data.attributes) : null}::jsonb, "attributes"), "price" = COALESCE(${parsed.data.price ?? null}, "price"), "stock" = COALESCE(${parsed.data.stock ?? null}, "stock"), "lowStockAt" = COALESCE(${parsed.data.lowStockAt ?? null}, "lowStockAt"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Product variation not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("inventory.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await auth.db.$executeRaw`DELETE FROM "ProductVariant" WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Product variation not found", 404);
  return NextResponse.json({ ok: true });
}
