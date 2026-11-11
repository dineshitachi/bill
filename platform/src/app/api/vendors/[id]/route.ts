import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { encryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ name: z.string().trim().min(1).max(160).optional(), phone: z.string().trim().max(32).optional(), email: z.string().trim().email().or(z.literal("")).optional(), taxId: z.string().trim().max(32).optional(), address: z.string().trim().max(500).optional(), currency: z.string().trim().toUpperCase().length(3).optional(), paymentTermsDays: z.number().int().min(0).max(365).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("vendors.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid vendor update");
  const current = await auth.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Vendor" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!current[0]) return jsonError("Vendor not found", 404);
  await auth.db.$executeRaw`UPDATE "Vendor" SET "name" = COALESCE(${parsed.data.name === undefined ? null : encryptField(parsed.data.name)}, "name"), "phone" = COALESCE(${parsed.data.phone === undefined ? null : encryptField(parsed.data.phone)}, "phone"), "email" = COALESCE(${parsed.data.email === undefined ? null : encryptField(parsed.data.email)}, "email"), "taxId" = COALESCE(${parsed.data.taxId === undefined ? null : encryptField(parsed.data.taxId)}, "taxId"), "address" = COALESCE(${parsed.data.address === undefined ? null : encryptField(parsed.data.address)}, "address"), "currency" = COALESCE(${parsed.data.currency || null}, "currency"), "paymentTermsDays" = COALESCE(${parsed.data.paymentTermsDays ?? null}, "paymentTermsDays"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const used = await auth.db.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "PurchaseOrder" WHERE "vendorId" = ${id}::uuid`;
  if (Number(used[0]?.count || 0) > 0) return jsonError("Vendor has purchase orders and cannot be deleted", 409);
  const result = await auth.db.$executeRaw`DELETE FROM "Vendor" WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Vendor not found", 404);
  return NextResponse.json({ ok: true });
}
