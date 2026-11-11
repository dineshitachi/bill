import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { requireSession, type Role } from "@/server/auth";

export type PlanCode = "DEMO" | "TRIAL" | "FULL" | "SUSPENDED";
export type Entitlement = "invoice.create" | "product.create" | "user.create" | "template.cloud" | "compliance.einvoice" | "integration.use";
export type SubscriptionState = {
  onboardingState: string; subscriptionStatus: string; planCode: PlanCode; trialStartedAt: string; trialEndsAt: string | null;
  limits: { users: number; products: number; invoicesPerMonth: number }; features: Record<string, boolean>; daysRemaining: number | null; expired: boolean;
};

const planFeatures: Record<PlanCode, Record<string, boolean>> = {
  DEMO: { invoiceCreate: true, cloudTemplates: false, compliance: false, integrations: false },
  TRIAL: { invoiceCreate: true, cloudTemplates: true, compliance: true, integrations: true },
  FULL: { invoiceCreate: true, cloudTemplates: true, compliance: true, integrations: true },
  SUSPENDED: { invoiceCreate: false, cloudTemplates: false, compliance: false, integrations: false },
};

function planCode(value: string): PlanCode {
  return value === "TRIAL" || value === "FULL" || value === "SUSPENDED" ? value : "DEMO";
}

export async function getSubscription(tenantId: string): Promise<SubscriptionState> {
  const rows = await prisma.$queryRaw<Array<{ onboardingState: string; subscriptionStatus: string; planCode: string; trialStartedAt: Date; trialEndsAt: Date | null; maxUsers: number; maxProducts: number; maxInvoicesPerMonth: number }>>`
    SELECT "onboardingState", "subscriptionStatus", "planCode", "trialStartedAt", "trialEndsAt", "maxUsers", "maxProducts", "maxInvoicesPerMonth" FROM "Tenant" WHERE "id" = ${tenantId}::uuid LIMIT 1
  `;
  const record = rows[0];
  if (!record) throw new Error("Subscription tenant was not found");
  const code = planCode(record.planCode);
  const now = Date.now();
  const trialEnds = record.trialEndsAt?.getTime() ?? null;
  const expired = code !== "FULL" && trialEnds !== null && trialEnds < now;
  const effectiveCode = expired ? "SUSPENDED" : code;
  const daysRemaining = trialEnds === null ? null : Math.max(0, Math.ceil((trialEnds - now) / 86_400_000));
  return {
    onboardingState: record.onboardingState,
    subscriptionStatus: expired ? "EXPIRED" : record.subscriptionStatus,
    planCode: effectiveCode,
    trialStartedAt: record.trialStartedAt.toISOString(),
    trialEndsAt: record.trialEndsAt?.toISOString() || null,
    limits: { users: record.maxUsers, products: record.maxProducts, invoicesPerMonth: record.maxInvoicesPerMonth },
    features: planFeatures[effectiveCode], daysRemaining, expired,
  };
}

export async function requireSubscription(entitlement: Entitlement, roles?: Role[]) {
  const auth = await requireSession(roles);
  if ("response" in auth) return auth;
  const subscription = await getSubscription(auth.session.tenantId);
  const enabled = entitlement === "invoice.create" ? subscription.features.invoiceCreate
    : entitlement === "product.create" || entitlement === "user.create" ? true
      : entitlement === "template.cloud" ? subscription.features.cloudTemplates
        : entitlement === "compliance.einvoice" ? subscription.features.compliance
          : subscription.features.integrations;
  if (!enabled || subscription.expired) return { response: NextResponse.json({ error: "This feature is unavailable for the current subscription", code: "SUBSCRIPTION_REQUIRED", subscription }, { status: 402 }) };
  if (entitlement === "invoice.create") {
    const rows = await auth.db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "Invoice" WHERE "issuedAt" >= date_trunc('month', CURRENT_TIMESTAMP)`;
    if ((rows[0]?.count || 0) >= subscription.limits.invoicesPerMonth) return { response: NextResponse.json({ error: "Monthly invoice limit reached for this plan", code: "PLAN_LIMIT_REACHED", limit: subscription.limits.invoicesPerMonth }, { status: 402 }) };
  }
  if (entitlement === "product.create") {
    const rows = await auth.db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "Product"`;
    if ((rows[0]?.count || 0) >= subscription.limits.products) return { response: NextResponse.json({ error: "Product limit reached for this plan", code: "PLAN_LIMIT_REACHED", limit: subscription.limits.products }, { status: 402 }) };
  }
  if (entitlement === "user.create") {
    const rows = await auth.db.$queryRaw<Array<{ count: number }>>`SELECT COUNT(*)::int AS count FROM "User" WHERE "disabledAt" IS NULL`;
    if ((rows[0]?.count || 0) >= subscription.limits.users) return { response: NextResponse.json({ error: "User limit reached for this plan", code: "PLAN_LIMIT_REACHED", limit: subscription.limits.users }, { status: 402 }) };
  }
  return { ...auth, subscription };
}

export async function recordSubscriptionEvent(tenantId: string, eventType: string, fromPlan: string, toPlan: string, metadata: Record<string, unknown> = {}) {
  await prisma.$executeRaw`INSERT INTO "SubscriptionEvent" ("id", "tenantId", "eventType", "fromPlan", "toPlan", "metadata") VALUES (${randomUUID()}::uuid, ${tenantId}::uuid, ${eventType}, ${fromPlan}, ${toPlan}, ${JSON.stringify(metadata)}::jsonb)`;
}
