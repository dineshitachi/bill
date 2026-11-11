import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ decision: z.enum(["ACCEPTED", "DECLINED"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("A quotation decision is required");
  const { id } = await context.params;
  const userRows = await auth.db.$queryRaw<Array<{ customerId: string | null }>>`SELECT "customerId" FROM "User" WHERE "id" = ${auth.session.userId}::uuid LIMIT 1`;
  const quoteRows = await auth.db.$queryRaw<Array<{ customerId: string | null; status: string }>>`SELECT "customerId", "status" FROM "Quotation" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!quoteRows[0]) return jsonError("Quotation not found", 404);
  if (!userRows[0]?.customerId || userRows[0].customerId !== quoteRows[0].customerId) return jsonError("Quotation is not available to this customer", 403);
  if (!["SENT", "APPROVED"].includes(quoteRows[0].status)) return jsonError("Quotation is no longer awaiting a decision", 409);
  await auth.db.$executeRaw`UPDATE "Quotation" SET "status" = ${parsed.data.decision}, "acceptedAt" = CASE WHEN ${parsed.data.decision} = 'ACCEPTED' THEN CURRENT_TIMESTAMP ELSE "acceptedAt" END, "declinedAt" = CASE WHEN ${parsed.data.decision} = 'DECLINED' THEN CURRENT_TIMESTAMP ELSE "declinedAt" END, "version" = "version" + 1, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: `quotation.${parsed.data.decision.toLowerCase()}`, subject: id, details: { customerPortal: true } } });
  return NextResponse.json({ ok: true, status: parsed.data.decision });
}
