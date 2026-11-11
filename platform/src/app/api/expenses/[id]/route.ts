import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { encryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ category: z.string().trim().min(1).max(80).optional(), description: z.string().trim().min(1).max(500).optional(), amount: z.number().finite().positive().optional(), currency: z.string().trim().toUpperCase().length(3).optional(), occurredAt: z.string().datetime().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("expenses.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid expense update");
  const result = await auth.db.$executeRaw`UPDATE "Expense" SET "category" = COALESCE(${parsed.data.category || null}, "category"), "description" = COALESCE(${parsed.data.description === undefined ? null : encryptField(parsed.data.description)}, "description"), "amount" = COALESCE(${parsed.data.amount ?? null}, "amount"), "currency" = COALESCE(${parsed.data.currency || null}, "currency"), "occurredAt" = COALESCE(${parsed.data.occurredAt ? new Date(parsed.data.occurredAt) : null}, "occurredAt"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Expense not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("expenses.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await auth.db.$executeRaw`DELETE FROM "Expense" WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Expense not found", 404);
  return NextResponse.json({ ok: true });
}
