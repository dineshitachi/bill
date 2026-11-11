import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const permissions = ["dashboard.read", "billing.write", "inventory.read", "inventory.write", "customers.read", "customers.write", "invoices.read", "payments.write", "crm.write", "vendors.write", "expenses.write", "reports.read", "settings.write", "team.write", "security.audit", "documents.read", "integrations.write", "backups.write", "portal.read"] as const;
const schema = z.object({ userId: z.string().uuid(), grants: z.array(z.object({ permission: z.enum(permissions), enabled: z.boolean() })).max(permissions.length) });

export async function GET() {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const grants = await auth.db.$queryRaw`SELECT "userId", "permission", "enabled", "createdAt" FROM "UserPermission" ORDER BY "userId", "permission"`;
  return NextResponse.json({ permissions, grants });
}

export async function PUT(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid permission grants");
  await auth.db.$transaction(async (tx) => {
    await tx.$executeRaw`DELETE FROM "UserPermission" WHERE "userId" = ${parsed.data.userId}::uuid`;
    for (const grant of parsed.data.grants) await tx.$executeRaw`INSERT INTO "UserPermission" ("id", "userId", "permission", "enabled") VALUES (${randomUUID()}::uuid, ${parsed.data.userId}::uuid, ${grant.permission}, ${grant.enabled})`;
    await tx.auditLog.create({ data: { actorId: auth.session.userId, action: "permissions.updated", subject: parsed.data.userId, details: { grantCount: parsed.data.grants.length } } });
  });
  return NextResponse.json({ ok: true });
}
