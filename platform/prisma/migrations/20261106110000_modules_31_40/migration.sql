ALTER TABLE "Tenant"
  ADD COLUMN IF NOT EXISTS "onboardingState" TEXT NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN IF NOT EXISTS "subscriptionStatus" TEXT NOT NULL DEFAULT 'TRIAL',
  ADD COLUMN IF NOT EXISTS "planCode" TEXT NOT NULL DEFAULT 'DEMO',
  ADD COLUMN IF NOT EXISTS "trialStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "trialEndsAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "maxUsers" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS "maxProducts" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "maxInvoicesPerMonth" INTEGER NOT NULL DEFAULT 100;

-- User profile media belongs to each tenant schema; this public statement is
-- retained for installations that also keep the control-plane user table.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "avatarData" TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS "SubscriptionEvent" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromPlan" TEXT NOT NULL DEFAULT '',
  "toPlan" TEXT NOT NULL DEFAULT '',
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SubscriptionEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SubscriptionEvent_tenantId_createdAt_idx" ON "SubscriptionEvent"("tenantId", "createdAt");

CREATE TABLE IF NOT EXISTS "BusinessMembership" (
  "id" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'SALES',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BusinessMembership_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessMembership_userId_tenantId_key" UNIQUE ("userId", "tenantId")
);
CREATE INDEX IF NOT EXISTS "BusinessMembership_userId_idx" ON "BusinessMembership"("userId");
