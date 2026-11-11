import { NextResponse } from "next/server";
import { getEffectivePermissions, getSession } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { decryptTenant } from "@/server/field-encryption";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ user: null }, { status: 401 });
  const db = tenantDb(session.schemaName);
  const profileRows = await db.$queryRaw<Array<{ theme: string; avatarData: string }>>`SELECT "theme", "avatarData" FROM "User" WHERE "id" = ${session.userId}::uuid LIMIT 1`;
  const profile = profileRows[0];
  if (!profile) return NextResponse.json({ user: null }, { status: 401 });
  const permissions = await getEffectivePermissions(db, session.userId, session.role);
  const company = await prisma.tenant.findUnique({
    where: { id: session.tenantId },
    select: { name: true, legalName: true, gstin: true, stateCode: true, upiId: true, logoData: true, theme: true, lowStockNotifications: true, paymentNotifications: true },
  });
  return NextResponse.json({ user: { id: session.userId, username: session.username, displayName: session.displayName, role: session.role, theme: profile.theme, avatarData: profile.avatarData, permissions }, company: company ? decryptTenant(company) : null });
}
