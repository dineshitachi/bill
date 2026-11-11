import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ grants: z.array(z.object({ userId: z.string().uuid(), canView: z.boolean() })).max(500) });

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Expense not found", 404);
  const expense = await auth.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Expense" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!expense.length) return jsonError("Expense not found", 404);
  const [users, grants] = await Promise.all([
    auth.db.$queryRaw<Array<{ id: string; username: string; role: string }>>`
      SELECT "id", "username", "role" FROM "User" WHERE "disabledAt" IS NULL AND "role" = 'SALES' ORDER BY "username"
    `,
    auth.db.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId" FROM "DocumentAccess" WHERE "documentType" = 'EXPENSE_RECEIPT' AND "documentId" = ${id}::uuid AND "canView" = TRUE
    `,
  ]);
  return NextResponse.json({ users, grantedUserIds: grants.map((grant) => grant.userId) });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success) return jsonError("Expense not found", 404);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid document access grants");
  const expense = await auth.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Expense" WHERE "id" = ${id}::uuid LIMIT 1`;
  if (!expense.length) return jsonError("Expense not found", 404);

  const userIds = [...new Set(parsed.data.grants.map((grant) => grant.userId))];
  if (userIds.length !== parsed.data.grants.length) return jsonError("A user may only appear once in the access list");
  const users = userIds.length
    ? await auth.db.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id"::text = ANY(${userIds}) AND "role" = 'SALES' AND "disabledAt" IS NULL`
    : [];
  if (users.length !== userIds.length) return jsonError("Access can only be granted to active staff accounts");

  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "DocumentAccess" WHERE "documentType" = 'EXPENSE_RECEIPT' AND "documentId" = ${id}::uuid`;
    for (const grant of parsed.data.grants.filter((item) => item.canView)) {
      await tx.$executeRaw`INSERT INTO "DocumentAccess" ("id", "documentType", "documentId", "userId", "canView", "grantedBy") VALUES (${randomUUID()}::uuid, 'EXPENSE_RECEIPT', ${id}::uuid, ${grant.userId}::uuid, TRUE, ${auth.session.userId}::uuid)`;
    }
    await tx.auditLog.create({
      data: {
        actorId: auth.session.userId,
        action: "document.access.updated",
        subject: id,
        details: { documentType: "EXPENSE_RECEIPT", grantedCount: parsed.data.grants.filter((grant) => grant.canView).length },
      },
    });
  });
  return NextResponse.json({ ok: true });
}