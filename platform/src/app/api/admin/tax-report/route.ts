import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";

export async function GET(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const year = Number(new URL(request.url).searchParams.get("year") || new Date().getFullYear());
  const rows = await auth.db.$queryRaw`SELECT "sellerStateCode" AS "origin", "placeOfSupplyStateCode" AS "destination", COALESCE(SUM("taxTotal"), 0)::text AS "taxTotal", COALESCE(SUM("grandTotal"), 0)::text AS "grossTotal", COUNT(*)::int AS "invoiceCount" FROM "Invoice" WHERE EXTRACT(YEAR FROM "issuedAt") = ${year} GROUP BY "sellerStateCode", "placeOfSupplyStateCode" ORDER BY "origin", "destination"`;
  const notes = await auth.db.$queryRaw`SELECT "noteType", COALESCE(SUM("taxTotal"), 0)::text AS "taxTotal", COALESCE(SUM("total"), 0)::text AS "grossTotal", COUNT(*)::int AS "noteCount" FROM "CreditDebitNote" WHERE "status" = 'POSTED' AND EXTRACT(YEAR FROM "createdAt") = ${year} GROUP BY "noteType"`;
  return NextResponse.json({ year, jurisdictions: rows, adjustments: notes });
}
