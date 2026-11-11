import { createHash, randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { jsonError, readJson } from "@/server/http";

const heartbeatSchema = z.object({
  nodeId: z.string().trim().min(1).max(100),
  clientVersion: z.string().trim().min(1).max(40),
  operatingSystem: z.string().trim().min(1).max(80),
  device: z.string().trim().min(1).max(120),
  activeSessions: z.number().int().min(0).max(100_000),
  storageBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  transactionsToday: z.number().int().min(0).max(10_000_000),
});

export async function POST(request: Request) {
  const presented = request.headers.get("x-tenant-key") || "";
  if (!presented.startsWith("nbp_")) return jsonError("A tenant API key is required", 401);
  const digest = createHash("sha256").update(presented).digest();
  const tenant = await prisma.tenant.findUnique({ where: { apiKeyHash: digest.toString("hex") }, select: { id: true } });
  if (!tenant) return jsonError("Invalid tenant API key", 401);

  const body = await readJson(request);
  const parsed = heartbeatSchema.safeParse(body);
  if (!parsed.success) return jsonError("Invalid heartbeat data");
  await prisma.tenantNode.upsert({
    where: { tenantId_nodeId: { tenantId: tenant.id, nodeId: parsed.data.nodeId } },
    create: {
      id: randomUUID(),
      tenantId: tenant.id,
      ...parsed.data,
      storageBytes: BigInt(parsed.data.storageBytes),
    },
    update: {
      clientVersion: parsed.data.clientVersion,
      operatingSystem: parsed.data.operatingSystem,
      device: parsed.data.device,
      activeSessions: parsed.data.activeSessions,
      storageBytes: BigInt(parsed.data.storageBytes),
      transactionsToday: parsed.data.transactionsToday,
      lastHeartbeat: new Date(),
    },
  });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
