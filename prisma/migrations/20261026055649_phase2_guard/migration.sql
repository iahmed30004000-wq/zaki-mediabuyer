-- CreateTable
CREATE TABLE "ChangeSet" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceRef" TEXT,
    "reasonCode" TEXT NOT NULL,
    "sentence" TEXT NOT NULL,
    "accountMetaId" TEXT,
    "kind" TEXT NOT NULL,
    "spendDeltaDaily" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "simulation" JSONB,
    "writeMode" TEXT NOT NULL DEFAULT 'dry_run',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "followUp24" JSONB,
    "followUp72" JSONB,
    "rolledBackAt" TIMESTAMP(3),
    "rolledBackBy" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChangeItem" (
    "id" TEXT NOT NULL,
    "changeSetId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "apiResponse" JSONB,
    "verifyResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChangeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleRun" (
    "id" TEXT NOT NULL,
    "rule" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "alertOnly" BOOLEAN NOT NULL,
    "sentence" TEXT NOT NULL,
    "changeSetId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Freeze" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMP(3),
    "liftedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Freeze_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KillSwitchEvent" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "byUser" TEXT NOT NULL,
    "changeSetId" TEXT,
    "objects" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KillSwitchEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChangeSet_state_createdAt_idx" ON "ChangeSet"("state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChangeItem_idempotencyKey_key" ON "ChangeItem"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ChangeItem_objectId_createdAt_idx" ON "ChangeItem"("objectId", "createdAt");

-- CreateIndex
CREATE INDEX "RuleRun_rule_targetId_createdAt_idx" ON "RuleRun"("rule", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "Freeze_targetId_kind_idx" ON "Freeze"("targetId", "kind");

-- AddForeignKey
ALTER TABLE "ChangeItem" ADD CONSTRAINT "ChangeItem_changeSetId_fkey" FOREIGN KEY ("changeSetId") REFERENCES "ChangeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
