import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { requirePermission } from "@/server/auth";
import { jsonError } from "@/server/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("billing.write");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  try {
    const result = await auth.db.$transaction(async (tx) => {
      const notes = await tx.$queryRaw<Array<{ noteType: string; customerId: string | null; number: string; total: string; taxTotal: string; status: string }>>`SELECT "noteType", "customerId", "number", "total"::text AS "total", "taxTotal"::text AS "taxTotal", "status" FROM "CreditDebitNote" WHERE "id" = ${id}::uuid FOR UPDATE`;
      const note = notes[0]; if (!note) throw new Error("Note not found"); if (note.status !== "DRAFT") throw new Error("Only draft notes can be posted");
      const items = await tx.$queryRaw<Array<{ productId: string | null; quantity: string; name: string }>>`SELECT "productId", "quantity"::text AS "quantity", "name" FROM "CreditDebitNoteItem" WHERE "noteId" = ${id}::uuid`;
      for (const item of items) {
        if (!item.productId) continue;
        const locked = await tx.$queryRaw<Array<{ stock: string }>>`SELECT "stock"::text AS "stock" FROM "Product" WHERE "id" = ${item.productId}::uuid FOR UPDATE`;
        const before = Number(locked[0]?.stock || 0); const quantity = Number(item.quantity); const after = note.noteType === "CREDIT" || note.noteType === "SALES_RETURN" ? before + quantity : before - quantity;
        if (after < 0) throw new Error(`Not enough stock for ${item.name}`);
        await tx.$executeRaw`UPDATE "Product" SET "stock" = ${after}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${item.productId}::uuid`;
        await tx.$executeRaw`INSERT INTO "StockMovement" ("id", "productId", "movementType", "quantity", "beforeStock", "afterStock", "referenceType", "referenceId", "note", "createdBy") VALUES (${randomUUID()}::uuid, ${item.productId}::uuid, ${note.noteType === "DEBIT" ? "DEBIT_NOTE" : "SALES_RETURN"}, ${after - before}, ${before}, ${after}, 'NOTE', ${id}, ${note.noteType === "DEBIT" ? "Debit note" : "Sales return"}, ${auth.session.username})`;
      }
      await tx.$executeRaw`UPDATE "CreditDebitNote" SET "status" = 'POSTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${id}::uuid`;
      if (note.customerId) await tx.$executeRaw`INSERT INTO "PartyLedgerEntry" ("id", "partyType", "partyId", "referenceType", "referenceId", "referenceNumber", "debit", "credit", "description", "createdBy") VALUES (${randomUUID()}::uuid, 'CUSTOMER', ${note.customerId}::uuid, ${note.noteType}, ${id}, ${note.number}, ${note.noteType === "DEBIT" ? Number(note.total) : 0}, ${note.noteType === "DEBIT" ? 0 : Number(note.total)}, 'Posted credit/debit note', ${auth.session.username})`;
      await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "note.posted", subject: id, details: { number: note.number, noteType: note.noteType, taxTotal: Number(note.taxTotal) } } });
      return { number: note.number, status: "POSTED" };
    });
    return NextResponse.json({ note: result });
  } catch (error) { const message = error instanceof Error ? error.message : "Note posting failed"; if (/not found|draft|stock/i.test(message)) return jsonError(message, 409); console.error("Note posting failed", error); return jsonError("Note could not be posted", 500); }
}
