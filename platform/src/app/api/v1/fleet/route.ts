import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { jsonError, readJson } from "@/server/http";
import { decryptField } from "@/server/field-encryption";

function isAuthorized(request: Request): boolean {
  const expected = process.env.PROVISIONING_SECRET || "";
  const presented = request.headers.get("x-provisioning-secret") || "";
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  return left.length >= 32 && left.length === right.length && timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return jsonError("Not authorized", 401);
  const [tenants, nodes] = await Promise.all([
    prisma.tenant.findMany({
      select: { id: true, name: true, slug: true, legalName: true, enabled: true, maintenanceMode: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.tenantNode.findMany({ orderBy: { lastHeartbeat: "desc" } }),
  ]);
  return NextResponse.json({
    tenants: tenants.map((tenant) => ({
      ...tenant,
      name: decryptField(tenant.name),
      legalName: decryptField(tenant.legalName),
    })),
    nodes: nodes.map((node) => ({ ...node, storageBytes: Number(node.storageBytes) })),
  });
}

const configSchema = z.object({
  tenantId: z.string().uuid(),
  enabled: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
}).refine((value) => value.enabled !== undefined || value.maintenanceMode !== undefined);

export async function PATCH(request: Request) {
  if (!isAuthorized(request)) return jsonError("Not authorized", 401);
  const body = await readJson(request);
  const parsed = configSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid tenant configuration");
  const tenant = await prisma.tenant.update({
    where: { id: parsed.data.tenantId },
    data: {
      ...(parsed.data.enabled === undefined ? {} : { enabled: parsed.data.enabled }),
      ...(parsed.data.maintenanceMode === undefined ? {} : { maintenanceMode: parsed.data.maintenanceMode }),
    },
    select: { id: true, name: true, slug: true, enabled: true, maintenanceMode: true },
  }).catch((error: unknown) => {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2025") return null;
    throw error;
  });
  if (!tenant) return jsonError("Tenant not found", 404);
  return NextResponse.json({ tenant: { ...tenant, name: decryptField(tenant.name) } });
}
