import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth";

export async function GET(request: Request) {
  const auth = await requirePermission("inventory.read");
  if ("response" in auth) return auth.response;
  const productId = new URL(request.url).searchParams.get("productId");
  const rows = productId
    ? await auth.db.$queryRaw`SELECT * FROM "StockMovement" WHERE "productId" = ${productId}::uuid ORDER BY "createdAt" DESC LIMIT 200`
    : await auth.db.$queryRaw`SELECT * FROM "StockMovement" ORDER BY "createdAt" DESC LIMIT 200`;
  return NextResponse.json({ movements: rows });
}
