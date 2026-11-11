import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const body = await readJson(request);
  if (body?.confirm !== "RESTORE") return jsonError("Explicit restore confirmation is required");
  const { id } = await context.params;
  const rows = await auth.db.$queryRaw<Array<{ payload: string; checksum: string }>>`SELECT "payload", "checksum" FROM "BackupRecord" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!rows[0]) return jsonError("Backup not found", 404);
  if (createHash("sha256").update(rows[0].payload).digest("hex") !== rows[0].checksum) return jsonError("Backup integrity check failed", 409);
  const snapshot: unknown = JSON.parse(rows[0].payload);
  if (typeof snapshot !== "object" || snapshot === null || !("tenantId" in snapshot) || snapshot.tenantId !== auth.session.tenantId) return jsonError("Backup belongs to a different tenant", 403);
  // Financial documents are immutable. Recovery rehydrates catalog/customer
  // records and leaves invoice history untouched so restoring cannot rewrite
  // an issued tax document or double-decrement stock.
  const data = snapshot as { products?: Array<Record<string, unknown>>; customers?: Array<Record<string, unknown>> };
  await auth.db.$transaction(async (tx) => {
    for (const product of data.products || []) {
      if (typeof product.id !== "string") continue;
      await tx.$executeRaw`INSERT INTO "Product" ("id", "name", "sku", "unit", "price", "stock", "lowStockAt", "gstRate", "hsnCode", "updatedAt") VALUES (${product.id}::uuid, ${String(product.name || "Restored item")}, ${String(product.sku || product.id)}, ${String(product.unit || "pcs")}, ${Number(product.price || 0)}, ${Number(product.stock || 0)}, ${Number(product.lowStockAt || 0)}, ${Number(product.gstRate || 0)}, ${String(product.hsnCode || "")}, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "unit" = EXCLUDED."unit", "price" = EXCLUDED."price", "stock" = EXCLUDED."stock", "lowStockAt" = EXCLUDED."lowStockAt", "gstRate" = EXCLUDED."gstRate", "hsnCode" = EXCLUDED."hsnCode", "updatedAt" = CURRENT_TIMESTAMP`;
    }
    for (const customer of data.customers || []) {
      if (typeof customer.id !== "string") continue;
      await tx.$executeRaw`INSERT INTO "Customer" ("id", "name", "phone", "email", "gstin", "state", "stateCode", "address") VALUES (${customer.id}::uuid, ${String(customer.name || "Restored customer")}, ${String(customer.phone || "")}, ${String(customer.email || "")}, ${String(customer.gstin || "")}, ${String(customer.state || "")}, ${String(customer.stateCode || "33")}, ${String(customer.address || "")}) ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "phone" = EXCLUDED."phone", "email" = EXCLUDED."email", "gstin" = EXCLUDED."gstin", "state" = EXCLUDED."state", "stateCode" = EXCLUDED."stateCode", "address" = EXCLUDED."address"`;
    }
    await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "backup.restored", subject: id, details: { products: data.products?.length || 0, customers: data.customers?.length || 0, invoicesSkipped: true } } });
  });
  return NextResponse.json({ ok: true, restored: { products: data.products?.length || 0, customers: data.customers?.length || 0 }, financialDocumentsPreserved: true });
}
