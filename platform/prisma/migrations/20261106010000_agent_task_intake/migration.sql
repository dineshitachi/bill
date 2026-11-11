CREATE TABLE "AgentTask" (
  "id" UUID NOT NULL,
  "description" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'TEXT',
  "screenshotMime" TEXT,
  "screenshotData" TEXT,
  "createdBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AgentTask_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AgentTask_status_createdAt_idx" ON "AgentTask"("status", "createdAt");
