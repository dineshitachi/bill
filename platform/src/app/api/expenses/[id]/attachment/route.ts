import { NextResponse } from "next/server";
import { z } from "zod";
import { requirePermission } from "@/server/auth";
import { decryptField } from "@/server/field-encryption";
import { jsonError } from "@/server/http";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission("documents.read");
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Receipt was not found", 404);
  const rows = await auth.db.$queryRaw<Array<{ attachmentName: string; attachmentData: string }>>`
    SELECT "attachmentName", "attachmentData" FROM "Expense" WHERE "id" = ${id}::uuid LIMIT 1
  `;
  const expense = rows[0];
  if (!expense?.attachmentData) return jsonError("Receipt was not found", 404);

  if (auth.session.role !== "ADMIN") {
    const grants = await auth.db.$queryRaw<Array<{ canView: boolean }>>`
      SELECT "canView" FROM "DocumentAccess"
      WHERE "documentType" = 'EXPENSE_RECEIPT' AND "documentId" = ${id}::uuid AND "userId" = ${auth.session.userId}::uuid
      LIMIT 1
    `;
    if (!grants[0]?.canView) return jsonError("You do not have access to this receipt", 403);
  }

  const attachmentData = decryptField(expense.attachmentData);
  await auth.db.auditLog.create({
    data: {
      actorId: auth.session.userId,
      action: "document.accessed",
      subject: id,
      details: { documentType: "EXPENSE_RECEIPT", attachmentName: expense.attachmentName },
    },
  });
  return NextResponse.json({ attachmentName: expense.attachmentName, attachmentData });
}