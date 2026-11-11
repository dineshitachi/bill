import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { requireSubscription } from "@/server/subscription";
import { jsonError, readJson } from "@/server/http";

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(64),
  unit: z.string().trim().min(1).max(20).default("pcs"),
  price: z.number().finite().min(0).max(1_000_000_000),
  stock: z.number().finite().min(0).max(1_000_000_000),
  lowStockAt: z.number().finite().min(0).max(1_000_000_000).default(5),
  gstRate: z.number().finite().min(0).max(100).default(18),
  hsnCode: z.string().trim().max(20).default(""),
});

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const products = await auth.db.product.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ products });
}

export async function POST(request: Request) {
  const auth = await requireSubscription("product.create", ["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid product details");
  try {
    const product = await auth.db.product.create({ data: parsed.data });
    await auth.db.auditLog.create({
      data: { actorId: auth.session.userId, action: "product.created", subject: product.id, details: { sku: product.sku } },
    });
    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      return jsonError("A product with that SKU already exists", 409);
    }
    throw error;
  }
}
