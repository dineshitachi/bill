import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const result = await auth.db.$executeRaw`UPDATE "Notification" SET "readAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid AND ("userId" = ${auth.session.userId}::uuid OR "userId" IS NULL)`;
  if (!result) return jsonError("Notification not found", 404);
  return NextResponse.json({ ok: true });
}
