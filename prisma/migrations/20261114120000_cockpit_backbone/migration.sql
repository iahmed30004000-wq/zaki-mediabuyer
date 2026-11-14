-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "startTime" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "AdSet" ADD COLUMN     "startTime" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Ad" ADD COLUMN     "startTime" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "StockSnapshot" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "units" INTEGER,
    "daysCover" DECIMAL(8,1) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoBankItem" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "vName" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "driveFileId" TEXT,
    "metaVideoId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'bank',
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VideoBankItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "schedule" TEXT,
    "executor" TEXT NOT NULL DEFAULT 'claude_mcp',
    "dataSource" TEXT NOT NULL DEFAULT 'mcp',
    "permission" TEXT NOT NULL DEFAULT 'green',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "graph" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger" TEXT NOT NULL DEFAULT 'schedule',
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT,
    "metrics" JSONB,
    "artifacts" JSONB,
    "nodeStates" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "ref" TEXT,
    "title" TEXT NOT NULL,
    "why" TEXT NOT NULL,
    "analysis" JSONB,
    "numbers" JSONB,
    "options" JSONB,
    "amount" DECIMAL(12,2),
    "urgency" TEXT NOT NULL DEFAULT 'orange',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "workflowKey" TEXT,
    "kind" TEXT,
    "expiresAt" TIMESTAMP(3),
    "postponedUntil" TIMESTAMP(3),
    "chosenOption" TEXT,
    "decisionNote" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "wakeOwner" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'owner',
    "title" TEXT NOT NULL,
    "body" TEXT,
    "href" TEXT,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "key" TEXT,
    "readAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "assignee" TEXT,
    "executor" TEXT,
    "dueAt" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "linkType" TEXT,
    "linkId" TEXT,
    "board" TEXT NOT NULL DEFAULT 'main',
    "source" TEXT NOT NULL DEFAULT 'ui',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "keys" JSONB,
    "label" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushDevice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockSnapshot_productCode_at_idx" ON "StockSnapshot"("productCode", "at");

-- CreateIndex
CREATE INDEX "VideoBankItem_productCode_status_idx" ON "VideoBankItem"("productCode", "status");

-- CreateIndex
CREATE UNIQUE INDEX "VideoBankItem_job_vName_key" ON "VideoBankItem"("job", "vName");

-- CreateIndex
CREATE UNIQUE INDEX "Workflow_key_key" ON "Workflow"("key");

-- CreateIndex
CREATE INDEX "WorkflowRun_startedAt_idx" ON "WorkflowRun"("startedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_idx" ON "WorkflowRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_workflowId_ref_key" ON "WorkflowRun"("workflowId", "ref");

-- CreateIndex
CREATE UNIQUE INDEX "Approval_ref_key" ON "Approval"("ref");

-- CreateIndex
CREATE INDEX "Approval_status_createdAt_idx" ON "Approval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_audience_createdAt_idx" ON "Notification"("audience", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_audience_key_key" ON "Notification"("audience", "key");

-- CreateIndex
CREATE INDEX "Task_status_board_idx" ON "Task"("status", "board");

-- CreateIndex
CREATE INDEX "Task_assignee_idx" ON "Task"("assignee");

-- CreateIndex
CREATE UNIQUE INDEX "PushDevice_token_key" ON "PushDevice"("token");

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

