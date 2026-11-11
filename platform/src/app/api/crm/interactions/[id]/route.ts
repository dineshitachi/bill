import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ subject: z.string().trim().min(1).max(160).optional(), body: z.string().max(5000).optional(), completed: z.boolean().optional(), dueAt: z.string().datetime().nullable().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("crm.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid CRM interaction update");
  const result = await auth.db.$executeRaw`UPDATE "CrmInteraction" SET "subject" = COALESCE(${parsed.data.subject || null}, "subject"), "body" = COALESCE(${parsed.data.body ?? null}, "body"), "dueAt" = COALESCE(${parsed.data.dueAt === undefined ? null : parsed.data.dueAt ? new Date(parsed.data.dueAt) : null}, "dueAt"), "completedAt" = CASE WHEN ${parsed.data.completed === true} THEN CURRENT_TIMESTAMP WHEN ${parsed.data.completed === false} THEN NULL ELSE "completedAt" END, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("CRM interaction not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("crm.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await auth.db.$executeRaw`DELETE FROM "CrmInteraction" WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("CRM interaction not found", 404);
  return NextResponse.json({ ok: true });
}
