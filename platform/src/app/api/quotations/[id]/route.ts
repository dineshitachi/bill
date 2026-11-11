import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const patchSchema = z.object({
  status: z.enum(["DRAFT", "SENT", "APPROVED", "ACCEPTED", "DECLINED", "EXPIRED"]).optional(),
  terms: z.string().max(5000).optional(), validUntil: z.string().datetime().nullable().optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const rows = await auth.db.$queryRaw`SELECT * FROM "Quotation" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!rows[0]) return jsonError("Quotation not found", 404);
  const items = await auth.db.$queryRaw`SELECT * FROM "QuotationItem" WHERE "quotationId" = ${id}::uuid ORDER BY "id" ASC`;
  return NextResponse.json({ quotation: { ...rows[0], items } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success || (!parsed.data.status && parsed.data.terms === undefined && parsed.data.validUntil === undefined)) return jsonError("No quotation changes supplied");
  const existing = await auth.db.$queryRaw<Array<{ id: string; version: number }>>`SELECT "id", "version" FROM "Quotation" WHERE "id" = ${id}::uuid FOR UPDATE`;
  if (!existing[0]) return jsonError("Quotation not found", 404);
  await auth.db.$executeRaw`
    UPDATE "Quotation" SET "status" = COALESCE(${parsed.data.status || null}, "status"), "terms" = COALESCE(${parsed.data.terms ?? null}, "terms"), "validUntil" = COALESCE(${parsed.data.validUntil === undefined ? null : parsed.data.validUntil ? new Date(parsed.data.validUntil) : null}, "validUntil"), "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid
  `;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "quotation.updated", subject: id, details: { version: Number(existing[0].version) + 1 } } });
  return NextResponse.json({ ok: true, version: Number(existing[0].version) + 1 });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const rows = await auth.db.$queryRaw<Array<{ status: string }>>`SELECT "status" FROM "Quotation" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!rows[0]) return jsonError("Quotation not found", 404);
  if (!["DRAFT", "DECLINED", "EXPIRED"].includes(rows[0].status)) return jsonError("Only inactive quotations can be deleted", 409);
  await auth.db.$transaction([auth.db.$executeRaw`DELETE FROM "QuotationItem" WHERE "quotationId" = ${id}::uuid`, auth.db.$executeRaw`DELETE FROM "Quotation" WHERE "id" = ${id}::uuid`]);
  return NextResponse.json({ ok: true });
}
