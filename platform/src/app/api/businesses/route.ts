import { NextResponse } from "next/server";
import { z } from "zod";
import { createSession, getSession, requireSession, setSessionCookie } from "@/server/auth";
import { prisma, tenantDb } from "@/server/db";
import { decryptField } from "@/server/field-encryption";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ tenantId: z.string().uuid() });

export async function GET() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const rows = await prisma.$queryRaw<Array<{ tenantId: string; role: string; name: string; slug: string; legalName: string; gstin: string; logoData: string; enabled: boolean }>>`
    SELECT m."tenantId", m."role", t."name", t."slug", t."legalName", t."gstin", t."logoData", t."enabled" FROM "BusinessMembership" m JOIN "Tenant" t ON t."id" = m."tenantId" WHERE m."userId" = ${auth.session.userId}::uuid ORDER BY t."name" ASC
  `;
  const businesses = rows.filter((row) => row.enabled).map((row) => ({ tenantId: row.tenantId, role: row.role, name: decryptField(row.name), slug: row.slug, legalName: decryptField(row.legalName), gstin: decryptField(row.gstin), logoData: decryptField(row.logoData), active: row.tenantId === auth.session.tenantId }));
  if (!businesses.length) {
    const current = await prisma.$queryRaw<Array<{ id: string; name: string; slug: string; legalName: string; gstin: string; logoData: string }>>`SELECT "id", "name", "slug", "legalName", "gstin", "logoData" FROM "Tenant" WHERE "id" = ${auth.session.tenantId}::uuid LIMIT 1`;
    if (current[0]) businesses.push({ tenantId: current[0].id, role: auth.session.role, name: decryptField(current[0].name), slug: current[0].slug, legalName: decryptField(current[0].legalName), gstin: decryptField(current[0].gstin), logoData: decryptField(current[0].logoData), active: true });
  }
  return NextResponse.json({ businesses });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("A valid business is required");
  const rows = await prisma.$queryRaw<Array<{ tenantId: string; role: "ADMIN" | "SALES" | "CUSTOMER"; schemaName: string; enabled: boolean; maintenanceMode: boolean }>>`
    SELECT m."tenantId", m."role", t."schemaName", t."enabled", t."maintenanceMode" FROM "BusinessMembership" m JOIN "Tenant" t ON t."id" = m."tenantId" WHERE m."userId" = ${session.userId}::uuid AND m."tenantId" = ${parsed.data.tenantId}::uuid LIMIT 1
  `;
  const membership = rows[0];
  if (!membership || !membership.enabled || membership.maintenanceMode) return jsonError("Business access is not available", 403);
  const user = await tenantDb(membership.schemaName).user.findUnique({ where: { id: session.userId }, select: { disabledAt: true, role: true } });
  if (!user || user.disabledAt) return jsonError("Business account is not available", 403);
  const token = await createSession({ userId: user.id, role: membership.role, tenantId: membership.tenantId, schemaName: membership.schemaName });
  const response = NextResponse.json({ ok: true, tenantId: membership.tenantId });
  setSessionCookie(response, token);
  return response;
}
