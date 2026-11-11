import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { requireSession } from "@/server/auth";
import { jsonError, readJson } from "@/server/http";
import { getSubscription, recordSubscriptionEvent } from "@/server/subscription";

const schema = z.object({ planCode: z.enum(["FULL"]) });

export async function GET() {
  const auth = await requireSession();
  if ("response" in auth) return auth.response;
  return NextResponse.json({ subscription: await getSubscription(auth.session.tenantId) });
}

export async function POST(request: Request) {
  const auth = await requireSession(["ADMIN", "SALES"]);
  if ("response" in auth) return auth.response;
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Select a valid subscription plan");
  const current = await getSubscription(auth.session.tenantId);
  if (current.planCode === "FULL") return NextResponse.json({ subscription: current });
  await prisma.$executeRaw`UPDATE "Tenant" SET "planCode" = 'FULL', "subscriptionStatus" = 'ACTIVE', "onboardingState" = 'ACTIVE', "maxUsers" = 1000, "maxProducts" = 100000, "maxInvoicesPerMonth" = 100000, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${auth.session.tenantId}::uuid`;
  await recordSubscriptionEvent(auth.session.tenantId, "UPGRADED", current.planCode, "FULL", { requestedBy: auth.session.userId });
  await auth.db.auditLog.create({ data: { actorId: auth.session.userId, action: "subscription.upgraded", subject: auth.session.tenantId, details: { from: current.planCode, to: "FULL" } } });
  return NextResponse.json({ subscription: await getSubscription(auth.session.tenantId) });
}
