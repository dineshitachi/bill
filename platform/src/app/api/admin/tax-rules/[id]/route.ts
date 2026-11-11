import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ name: z.string().trim().min(1).max(120).optional(), rate: z.number().finite().min(0).max(100).optional(), origin: z.string().trim().max(80).optional(), destination: z.string().trim().max(80).optional(), active: z.boolean().optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid tax rule update");
  const result = await auth.db.$executeRaw`UPDATE "TaxRule" SET "name" = COALESCE(${parsed.data.name || null}, "name"), "rate" = COALESCE(${parsed.data.rate ?? null}, "rate"), "origin" = COALESCE(${parsed.data.origin ?? null}, "origin"), "destination" = COALESCE(${parsed.data.destination ?? null}, "destination"), "active" = COALESCE(${parsed.data.active ?? null}, "active"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Tax rule not found", 404);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await auth.db.$executeRaw`UPDATE "TaxRule" SET "active" = FALSE, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  if (!result) return jsonError("Tax rule not found", 404);
  return NextResponse.json({ ok: true });
}
