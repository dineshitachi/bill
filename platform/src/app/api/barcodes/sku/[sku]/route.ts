import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth";
import { jsonError } from "@/server/http";
import { renderBarcodeSvg } from "@/server/barcode";

export async function GET(_request: Request, context: { params: Promise<{ sku: string }> }) {
  const auth = await requirePermission("inventory.read");
  if ("response" in auth) return auth.response;
  const { sku } = await context.params;
  const product = await auth.db.product.findUnique({ where: { sku } });
  if (!product) return jsonError("SKU not found", 404);
  return new NextResponse(renderBarcodeSvg(product.sku), { headers: { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "private, max-age=300" } });
}
