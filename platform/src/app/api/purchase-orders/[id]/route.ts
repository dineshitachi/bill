import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ status: z.enum(["DRAFT", "SENT", "PARTIAL", "RECEIVED", "CANCELLED"]).optional(), expectedAt: z.string().datetime().nullable().optional(), paidAmount: z.number().finite().min(0).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid purchase order update");
  const result = await auth.db.$executeRaw`UPDATE "PurchaseOrder" SET "status" = COALESCE(${parsed.data.status || null}, "status"), "expectedAt" = COALESCE(${parsed.data.expectedAt === undefined ? null : parsed.data.expectedAt ? new Date(parsed.data.expectedAt) : null}, "expectedAt"), "paidAmount" = COALESCE(${parsed.data.paidAmount ?? null}, "paidAmount"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Purchase order not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const rows = await auth.db.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "PurchaseOrder" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!rows[0]) return jsonError("Purchase order not found", 404);
  if (rows[0].status !== "DRAFT") return jsonError("Only draft purchase orders can be deleted", 409);
  await auth.db.$transaction([auth.db.$executeRaw`DELETE FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = ${id}::uuid`, auth.db.$executeRaw`DELETE FROM "PurchaseOrder" WHERE "id" = ${id}::uuid`]);
  return NextResponse.json({ ok: true });
}
