import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { jsonError } from "@/server/http";

export async function GET() {
  const auth = await requireSession(["CUSTOMER"]);
  if ("response" in auth) return auth.response;
  const scope = await auth.db.$queryRaw<Array<{ customerId: string | null }>>`SELECT "customerId" FROM "User" WHERE "id" = ${auth.session.userId}::uuid LIMIT 1`;
  if (!scope[0]?.customerId) return jsonError("Customer portal is not linked to a customer record", 403);
  const rows = await auth.db.$queryRaw<Array<{ billed: string; paid: string }>>`SELECT COALESCE(SUM("grandTotal"), 0)::text AS "billed", COALESCE(SUM("amountPaid"), 0)::text AS "paid" FROM "Invoice" WHERE "customerId" = ${scope[0].customerId}::uuid`;
  const billed = Number(rows[0]?.billed || 0); const paid = Number(rows[0]?.paid || 0);
  return NextResponse.json({ statement: { billed, paid, due: Math.max(0, billed - paid) } });
}
