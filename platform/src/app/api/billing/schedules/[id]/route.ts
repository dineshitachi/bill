import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const patchSchema = z.object({ status: z.enum(["ACTIVE", "PAUSED", "COMPLETED"]).optional(), nextRunAt: z.string().datetime().optional(), endAt: z.string().datetime().nullable().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid recurring schedule update");
  const result = await auth.db.$executeRaw`
    UPDATE "BillingSchedule" SET "status" = COALESCE(${parsed.data.status || null}, "status"), "nextRunAt" = COALESCE(${parsed.data.nextRunAt ? new Date(parsed.data.nextRunAt) : null}, "nextRunAt"), "endAt" = COALESCE(${parsed.data.endAt === undefined ? null : parsed.data.endAt ? new Date(parsed.data.endAt) : null}, "endAt"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid
  `;
  if (!result) return jsonError("Schedule not found", 404);
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "billing.schedule.updated", subject: id, details: parsed.data } });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await auth.db.$executeRaw`UPDATE "BillingSchedule" SET "status" = 'COMPLETED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Schedule not found", 404);
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "billing.schedule.completed", subject: id, details: {} } });
  return NextResponse.json({ ok: true });
}
