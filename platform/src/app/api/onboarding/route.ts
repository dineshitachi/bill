import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";

const schema = z.object({ state: z.enum(["TRIAL", "PROFILE", "CATALOG", "READY", "ACTIVE"]) });
const transitions: Record<string, string[]> = { TRIAL: ["PROFILE", "ACTIVE"], PROFILE: ["CATALOG", "TRIAL"], CATALOG: ["READY", "PROFILE"], READY: ["ACTIVE", "CATALOG"], ACTIVE: ["ACTIVE"] };

export async function GET() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  const rows = await prisma.$queryRaw<Array<{ onboardingState: string; planCode: string; subscriptionStatus: string }>>`SELECT "onboardingState", "planCode", "subscriptionStatus" FROM "Tenant" WHERE "id" = ${auth.session.tenantId}::uuid LIMIT 1`;
  return NextResponse.json({ onboarding: rows[0] });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request)); if (!parsed.success) return jsonError("Invalid onboarding state");
  const current = await prisma.$queryRaw<Array<{ onboardingState: string }>>`SELECT "onboardingState" FROM "Tenant" WHERE "id" = ${auth.session.tenantId}::uuid LIMIT 1`;
  if (!current[0] || !transitions[current[0].onboardingState]?.includes(parsed.data.state)) return jsonError("Onboarding state transition is not allowed", 409);
  await prisma.$executeRaw`UPDATE "Tenant" SET "onboardingState" = ${parsed.data.state}, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${auth.session.tenantId}::uuid`;
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "onboarding.state.updated", subject: auth.session.tenantId, details: { from: current[0].onboardingState, to: parsed.data.state } } });
  return NextResponse.json({ onboardingState: parsed.data.state });
}
