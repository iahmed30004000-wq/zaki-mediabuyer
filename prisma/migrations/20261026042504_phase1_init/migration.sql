-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADS_MANAGER', 'ANALYST', 'VIEWER');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "sessionVer" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SettingVersion" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "changedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SettingVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetaConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "kind" TEXT NOT NULL,
    "scopes" TEXT[],
    "tokenEnc" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "checkedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "market" TEXT,
    "autonomyLevel" INTEGER NOT NULL DEFAULT 1,
    "dailyCap" DECIMAL(12,2),
    "monthlyCap" DECIMAL(12,2),
    "spendCapMeta" DECIMAL(12,2),
    "paymentStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Page" (
    "id" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Page_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dataset" (
    "id" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiUsage" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "callCount" INTEGER NOT NULL,
    "cpuTime" INTEGER NOT NULL,
    "totalTime" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "objective" TEXT,
    "parsedMarket" TEXT,
    "productCode" TEXT,
    "parsedObjective" TEXT,
    "stage" TEXT,
    "namingOk" BOOLEAN NOT NULL DEFAULT false,
    "productVia" TEXT,
    "budgetType" TEXT,
    "dailyBudget" DECIMAL(12,2),
    "bidStrategy" TEXT,
    "spendCap" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdSet" (
    "id" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "audienceCode" TEXT,
    "pageCode" TEXT,
    "conceptId" TEXT,
    "optimizationGoal" TEXT,
    "dailyBudget" DECIMAL(12,2),
    "learningStage" TEXT,
    "lastSignificantEditAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ad" (
    "id" TEXT NOT NULL,
    "metaId" TEXT NOT NULL,
    "adSetId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "creativeCode" TEXT,
    "hookCode" TEXT,
    "angleCode" TEXT,
    "lpCode" TEXT,
    "reviewStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsightDaily" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "impressions" INTEGER NOT NULL,
    "reach" INTEGER NOT NULL,
    "frequency" DECIMAL(8,4) NOT NULL,
    "linkClicks" INTEGER NOT NULL,
    "outboundClicks" INTEGER NOT NULL,
    "lpv" INTEGER NOT NULL,
    "purchases" INTEGER NOT NULL,
    "conversations" INTEGER NOT NULL,
    "video3s" INTEGER NOT NULL,
    "thruplays" INTEGER NOT NULL,
    "p25" INTEGER NOT NULL,
    "p50" INTEGER NOT NULL,
    "p75" INTEGER NOT NULL,
    "p95" INTEGER NOT NULL,
    "p100" INTEGER NOT NULL,
    "qualityRanking" TEXT,
    "engagementRanking" TEXT,
    "conversionRanking" TEXT,
    "attributionSetting" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'api',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsightDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttributedOrder" (
    "id" TEXT NOT NULL,
    "omsOrderId" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "adId" TEXT,
    "adSetId" TEXT,
    "campaignId" TEXT,
    "adName" TEXT,
    "lpUrl" TEXT,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAtOms" TIMESTAMP(3) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "shippedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "canceledAt" TIMESTAMP(3),
    "orderValue" DECIMAL(12,2) NOT NULL,
    "collected" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "isFake" BOOLEAN NOT NULL DEFAULT false,
    "capiRef" TEXT,
    "matureAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttributedOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruthDaily" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "spendWithFee" DECIMAL(12,2) NOT NULL,
    "orders" INTEGER NOT NULL,
    "matureOrders" INTEGER NOT NULL,
    "confirmed" INTEGER NOT NULL,
    "shipments" INTEGER NOT NULL,
    "delivered" INTEGER NOT NULL,
    "returned" INTEGER NOT NULL,
    "costPerConfirmed" DECIMAL(12,4),
    "confirmRate" DECIMAL(8,6),
    "deliveryRate" DECIMAL(8,6),
    "returnRate" DECIMAL(8,6),
    "netCollected" DECIMAL(12,2) NOT NULL,
    "lossLimit" DECIMAL(12,4),
    "scalingCeiling" DECIMAL(12,4),
    "profitAfterCosts" DECIMAL(12,2) NOT NULL,
    "profitPerDelivered" DECIMAL(12,4),
    "trueRoas" DECIMAL(10,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TruthDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnattributedPool" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignMetaId" TEXT NOT NULL,
    "spend" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UnattributedPool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductEconomics" (
    "id" TEXT NOT NULL,
    "productCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "deliveryFee" DECIMAL(12,2) NOT NULL,
    "returnFee" DECIMAL(12,2) NOT NULL,
    "codFeePct" DECIMAL(6,4) NOT NULL,
    "confirmCost" DECIMAL(12,2) NOT NULL,
    "stockDays" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'estimate',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductEconomics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "job" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,
    "stats" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "tone" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "href" TEXT,
    "sentAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "forDate" DATE NOT NULL,
    "text" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "blocked" TEXT,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SettingVersion_key_version_key" ON "SettingVersion"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_metaId_key" ON "AdAccount"("metaId");

-- CreateIndex
CREATE UNIQUE INDEX "Page_metaId_key" ON "Page"("metaId");

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_metaId_key" ON "Dataset"("metaId");

-- CreateIndex
CREATE INDEX "ApiUsage_createdAt_idx" ON "ApiUsage"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_metaId_key" ON "Campaign"("metaId");

-- CreateIndex
CREATE UNIQUE INDEX "AdSet_metaId_key" ON "AdSet"("metaId");

-- CreateIndex
CREATE UNIQUE INDEX "Ad_metaId_key" ON "Ad"("metaId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_productCode_alias_key" ON "ProductAlias"("productCode", "alias");

-- CreateIndex
CREATE INDEX "InsightDaily_date_idx" ON "InsightDaily"("date");

-- CreateIndex
CREATE UNIQUE INDEX "InsightDaily_level_objectId_date_key" ON "InsightDaily"("level", "objectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttributedOrder_omsOrderId_key" ON "AttributedOrder"("omsOrderId");

-- CreateIndex
CREATE INDEX "AttributedOrder_adId_idx" ON "AttributedOrder"("adId");

-- CreateIndex
CREATE INDEX "AttributedOrder_productCode_createdAtOms_idx" ON "AttributedOrder"("productCode", "createdAtOms");

-- CreateIndex
CREATE UNIQUE INDEX "TruthDaily_level_objectId_date_key" ON "TruthDaily"("level", "objectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "UnattributedPool_campaignMetaId_date_key" ON "UnattributedPool"("campaignMetaId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProductEconomics_productCode_key" ON "ProductEconomics"("productCode");

-- CreateIndex
CREATE INDEX "JobRun_job_startedAt_idx" ON "JobRun"("job", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_job_slot_key" ON "JobRun"("job", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "Report_kind_forDate_key" ON "Report"("kind", "forDate");

-- CreateIndex
CREATE INDEX "AgentRun_agent_createdAt_idx" ON "AgentRun"("agent", "createdAt");

-- AddForeignKey
ALTER TABLE "SettingVersion" ADD CONSTRAINT "SettingVersion_key_fkey" FOREIGN KEY ("key") REFERENCES "Setting"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "AdAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdSet" ADD CONSTRAINT "AdSet_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ad" ADD CONSTRAINT "Ad_adSetId_fkey" FOREIGN KEY ("adSetId") REFERENCES "AdSet"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
