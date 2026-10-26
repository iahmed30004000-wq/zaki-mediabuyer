-- AlterTable
ALTER TABLE "ChangeItem" ADD COLUMN     "seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Experiment" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "hypothesis" TEXT NOT NULL,
    "setup" JSONB NOT NULL,
    "stopRules" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "changeSetId" TEXT,
    "campaignMetaId" TEXT,
    "startedAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "result" JSONB,
    "verdict" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CapiEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "omsOrderId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "eventTime" TIMESTAMP(3) NOT NULL,
    "datasetId" TEXT,
    "value" DECIMAL(12,2),
    "currency" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "response" JSONB,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CapiEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountHealth" (
    "id" TEXT NOT NULL,
    "accountMetaId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "disableReason" TEXT,
    "paymentOk" BOOLEAN NOT NULL DEFAULT true,
    "rejectedAds" INTEGER NOT NULL DEFAULT 0,
    "verdict" TEXT NOT NULL,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountHealth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewIssue" (
    "id" TEXT NOT NULL,
    "adMetaId" TEXT NOT NULL,
    "adName" TEXT NOT NULL,
    "accountMetaId" TEXT,
    "feedback" JSONB NOT NULL,
    "policyKey" TEXT,
    "appealDraft" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReviewIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Experiment_status_createdAt_idx" ON "Experiment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CapiEvent_eventId_key" ON "CapiEvent"("eventId");

-- CreateIndex
CREATE INDEX "CapiEvent_state_eventTime_idx" ON "CapiEvent"("state", "eventTime");

-- CreateIndex
CREATE INDEX "CapiEvent_omsOrderId_idx" ON "CapiEvent"("omsOrderId");

-- CreateIndex
CREATE INDEX "AccountHealth_accountMetaId_createdAt_idx" ON "AccountHealth"("accountMetaId", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewIssue_adMetaId_idx" ON "ReviewIssue"("adMetaId");

