import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const entries = await auth.db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  return NextResponse.json({ entries });
}
