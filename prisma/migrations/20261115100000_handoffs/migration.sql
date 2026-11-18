-- CreateTable
CREATE TABLE "Handoff" (
    "id" TEXT NOT NULL,
    "workflowKey" TEXT NOT NULL,
    "runRef" TEXT,
    "nodeId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "assignee" TEXT NOT NULL DEFAULT 'claude',
    "status" TEXT NOT NULL DEFAULT 'open',
    "claimedBy" TEXT,
    "claimedAt" TIMESTAMP(3),
    "result" JSONB,
    "resultNote" TEXT,
    "doneBy" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Handoff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Handoff_status_assignee_idx" ON "Handoff"("status", "assignee");

-- CreateIndex
CREATE INDEX "Handoff_workflowKey_status_idx" ON "Handoff"("workflowKey", "status");
