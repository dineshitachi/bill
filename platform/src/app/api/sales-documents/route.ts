import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ documentKind: z.enum(["PROFORMA", "SALES_ORDER", "DELIVERY_CHALLAN"]), customerId: z.string().uuid().optional(), currency: z.string().trim().toUpperCase().length(3).default("INR"), terms: z.string().max(5000).default(""), items: z.array(z.object({ productId: z.string().uuid().optional(), name: z.string().trim().min(1).max(160), quantity: z.number().positive(), unitPrice: z.number().nonnegative(), taxRate: z.number().min(0).max(100) })).min(1).max(100) });

export async function GET(request: Request) {
  const auth = await requirePermission("invoices.read");
  if ("response" in auth) return auth.response;
  const kind = new URL(request.url).searchParams.get("kind");
  const documents = kind ? await auth.db.$queryRaw`SELECT * FROM "SalesDocument" WHERE "documentKind" = ${kind} ORDER BY "createdAt" DESC LIMIT 500` : await auth.db.$queryRaw`SELECT * FROM "SalesDocument" ORDER BY "createdAt" DESC LIMIT 500`;
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("Invalid sales document");
  const id = randomUUID(); const number = `${parsed.data.documentKind.slice(0, 3)}-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
  const lines = parsed.data.items.map((item) => { const tax = Math.round(item.quantity * item.unitPrice * item.taxRate) / 100; return { ...item, tax, total: item.quantity * item.unitPrice + tax }; });
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0); const taxTotal = lines.reduce((sum, line) => sum + line.tax, 0);
  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "SalesDocument" ("id", "number", "documentKind", "customerId", "currency", "subtotal", "taxTotal", "total", "terms", "createdBy") VALUES (${id}::uuid, ${number}, ${parsed.data.documentKind}, ${parsed.data.customerId || null}::uuid, ${parsed.data.currency}, ${subtotal}, ${taxTotal}, ${subtotal + taxTotal}, ${parsed.data.terms}, ${auth.session.username})`;
    for (const line of lines) await tx.$executeRaw`INSERT INTO "SalesDocumentItem" ("id", "salesDocumentId", "productId", "name", "quantity", "unitPrice", "taxRate", "taxTotal", "total") VALUES (${randomUUID()}::uuid, ${id}::uuid, ${line.productId || null}::uuid, ${line.name}, ${line.quantity}, ${line.unitPrice}, ${line.taxRate}, ${line.tax}, ${line.total})`;
  });
  return NextResponse.json({ document: { id, number, documentKind: parsed.data.documentKind, status: "DRAFT", subtotal, taxTotal, total: subtotal + taxTotal } }, { status: 201 });
}
