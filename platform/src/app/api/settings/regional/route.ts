import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ baseCurrency: z.string().trim().toUpperCase().length(3), locale: z.string().trim().min(2).max(32), timeZone: z.string().trim().min(1).max(64), backupIntervalMinutes: z.number().int().min(15).max(10080).optional() });

export async function GET() {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const rows = await prisma.$queryRaw<Array<{ baseCurrency: string; locale: string; timeZone: string; backupIntervalMinutes: number; lastBackupAt: Date | null }>>`SELECT "baseCurrency", "locale", "timeZone", "backupIntervalMinutes", "lastBackupAt" FROM "Tenant" WHERE "id" = ${auth.session.tenantId}::uuid LIMIT 1`;
  return NextResponse.json({ regional: rows[0] || { baseCurrency: "INR", locale: "en-IN", timeZone: "Asia/Kolkata", backupIntervalMinutes: 1440, lastBackupAt: null } });
}

export async function PUT(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Invalid regional settings");
  await prisma.$executeRaw`UPDATE "Tenant" SET "baseCurrency" = ${parsed.data.baseCurrency}, "locale" = ${parsed.data.locale}, "timeZone" = ${parsed.data.timeZone}, "backupIntervalMinutes" = COALESCE(${parsed.data.backupIntervalMinutes ?? null}, "backupIntervalMinutes"), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${auth.session.tenantId}::uuid`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "regional.settings.updated", subject: auth.session.tenantId, details: parsed.data } });
  return NextResponse.json({ regional: parsed.data });
}
