import { randomBytes, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ noteType: z.enum(["CREDIT", "DEBIT", "SALES_RETURN"]), invoiceId: z.string().uuid().optional(), customerId: z.string().uuid().optional(), warehouseId: z.string().uuid().optional(), reason: z.string().trim().min(2).max(500), currency: z.string().trim().toUpperCase().length(3).default("INR"), items: z.array(z.object({ productId: z.string().uuid().optional(), name: z.string().trim().min(1).max(160), quantity: z.number().positive(), unitPrice: z.number().nonnegative(), taxRate: z.number().min(0).max(100) })).min(1).max(100) });

export async function GET() {
  const auth = await requirePermission("invoices.read");
  if ("response" in auth) return auth.response;
  const notes = await auth.db.$queryRaw`SELECT * FROM "CreditDebitNote" ORDER BY "createdAt" DESC LIMIT 500`;
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid credit/debit note");
  const id = randomUUID(); const number = `CN-${new Date().getFullYear()}-${randomBytes(5).toString("hex").toUpperCase()}`;
  const lines = parsed.data.items.map((item) => { const subtotal = item.quantity * item.unitPrice; const tax = Math.round(subtotal * item.taxRate) / 100; return { ...item, tax, total: subtotal + tax }; });
  const subtotal = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0); const taxTotal = lines.reduce((sum, line) => sum + line.tax, 0);
  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`INSERT INTO "CreditDebitNote" ("id", "number", "noteType", "invoiceId", "customerId", "warehouseId", "reason", "currency", "subtotal", "taxTotal", "total", "createdBy") VALUES (${id}::uuid, ${number}, ${parsed.data.noteType}, ${parsed.data.invoiceId || null}::uuid, ${parsed.data.customerId || null}::uuid, ${parsed.data.warehouseId || null}::uuid, ${parsed.data.reason}, ${parsed.data.currency}, ${subtotal}, ${taxTotal}, ${subtotal + taxTotal}, ${auth.session.username})`;
    for (const line of lines) await tx.$executeRaw`INSERT INTO "CreditDebitNoteItem" ("id", "noteId", "productId", "name", "quantity", "unitPrice", "taxRate", "taxTotal", "total") VALUES (${randomUUID()}::uuid, ${id}::uuid, ${line.productId || null}::uuid, ${line.name}, ${line.quantity}, ${line.unitPrice}, ${line.taxRate}, ${line.tax}, ${line.total})`;
    await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "note.created", subject: id, details: { number, noteType: parsed.data.noteType, total: subtotal + taxTotal } } });
  });
  return NextResponse.json({ note: { id, number, status: "DRAFT", noteType: parsed.data.noteType, subtotal, taxTotal, total: subtotal + taxTotal } }, { status: 201 });
}
