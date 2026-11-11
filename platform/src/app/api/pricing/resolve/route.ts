import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ productId: z.string().uuid(), quantity: z.number().positive(), customerCategory: z.string().trim().max(40).default("RETAIL"), rateCardCode: z.string().trim().toUpperCase().max(40).optional() });

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid pricing request");
  const product = await auth.db.product.findUnique({ where: { id: parsed.data.productId } });
  if (!product) return jsonError("Product not found", 404);
  const cards = parsed.data.rateCardCode
    ? await auth.db.$queryRaw<Array<{ id: string; code: string; customerCategory: string }>>`SELECT "id", "code", "customerCategory" FROM "RateCard" WHERE "code" = ${parsed.data.rateCardCode} AND "active" = TRUE LIMIT 1`
    : await auth.db.$queryRaw<Array<{ id: string; code: string; customerCategory: string }>>`SELECT "id", "code", "customerCategory" FROM "RateCard" WHERE "active" = TRUE AND ("customerCategory" = ${parsed.data.customerCategory} OR "customerCategory" = '') ORDER BY CASE WHEN "customerCategory" = ${parsed.data.customerCategory} THEN 0 ELSE 1 END LIMIT 1`;
  const card = cards[0];
  const prices = card ? await auth.db.$queryRaw<Array<{ unitPrice: string }>>`SELECT "unitPrice"::text AS "unitPrice" FROM "RateCardItem" WHERE "rateCardId" = ${card.id}::uuid AND "productId" = ${parsed.data.productId}::uuid AND "minQuantity" <= ${parsed.data.quantity} ORDER BY "minQuantity" DESC LIMIT 1` : [];
  const unitPrice = Number(prices[0]?.unitPrice || product.price);
  const response: { unitPrice: number; total: number; rateCard: string; margin?: number } = { unitPrice, total: Math.round(unitPrice * parsed.data.quantity * 100) / 100, rateCard: card?.code || "BASE" };
  if (auth.session.role === "ADMIN") response.margin = Math.round((unitPrice - Number(product.price) * 0.7) * 100) / 100;
  return NextResponse.json({ pricing: response });
}
