CREATE TABLE "AgentProfile" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "templateId" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentProfile_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentProfile_createdAt_idx" ON "AgentProfile"("createdAt");