import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sku: z.string().trim().min(1).max(64),
  unit: z.string().trim().min(1).max(20),
  price: z.number().finite().min(0).max(1_000_000_000),
  stock: z.number().finite().min(0).max(1_000_000_000),
  lowStockAt: z.number().finite().min(0).max(1_000_000_000),
  gstRate: z.number().finite().min(0).max(100),
  hsnCode: z.string().trim().max(20),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const body = await readJson(request);
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid product details");
  try {
    const product = await auth.db.product.update({ where: { id }, data: parsed.data });
    await auth.db.auditLog.create({
      data: { actorId: auth.session.userId, action: "product.updated", subject: product.id, details: { sku: product.sku } },
    });
    return NextResponse.json({ product });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return jsonError("Product not found", 404);
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") return jsonError("That SKU is already in use", 409);
    throw error;
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  const product = await auth.db.product.findUnique({ where: { id } });
  if (!product) return jsonError("Product not found", 404);
  const referenced = await auth.db.invoiceItem.count({ where: { productId: product.id } });
  if (referenced) return jsonError("This item appears on an invoice. Update its stock or price instead of deleting it.", 409);
  await auth.db.$transaction([
    auth.db.auditLog.create({
      data: { actorId: auth.session.userId, action: "product.deleted", subject: product.id, details: { sku: product.sku } },
    }),
    auth.db.product.delete({ where: { id: product.id } }),
  ]);
  return NextResponse.json({ ok: true });
}
