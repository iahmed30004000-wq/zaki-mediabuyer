-- v6 · P1-2 (docs/rebuild-v6/00-audit.md N-19 · N-20, 01-model.md §12): the indexes that were missing, and two checks on columns that gate things.
-- Safe on a live database: nothing is dropped, renamed, retyped or rewritten, and no row is touched. Each index is created if it is not there already.
-- Each check is added NOT VALID — it guards every NEW write at once and does not scan the rows that are already there — and only when no row already
-- breaks it (a row that did would be refused on its next update, whatever column the update touches): then the check is skipped with a notice and the
-- owner can fix the row and add it later by hand. So no row written before this can stop it from running, or stop the site from updating that row.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Campaign_accountId_idx" ON "Campaign"("accountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AdSet_campaignId_idx" ON "AdSet"("campaignId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Ad_adSetId_idx" ON "Ad"("adSetId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_createdAt_idx" ON "Alert"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Alert_sentAt_createdAt_idx" ON "Alert"("sentAt", "createdAt");

-- CreateIndex: the newest run of a job, and a job's runs by time (the list of jobs asks for them without one query per job)
CREATE INDEX IF NOT EXISTS "WorkflowRun_workflowId_startedAt_idx" ON "WorkflowRun"("workflowId", "startedAt");

-- N-20: a word that gates something cannot be a typo. The same lists the code holds (src/core/workflow.ts PERMISSIONS, src/core/changeset.ts STATES).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE "conname" = 'Workflow_permission_check') THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM "Workflow" WHERE "permission" NOT IN ('green', 'yellow', 'red', 'black')) THEN
    RAISE NOTICE 'Workflow.permission: a row has a word that is not green, yellow, red or black - the check is not added (fix the row, then add it)';
  ELSE
    ALTER TABLE "Workflow" ADD CONSTRAINT "Workflow_permission_check" CHECK ("permission" IN ('green', 'yellow', 'red', 'black')) NOT VALID;
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE "conname" = 'ChangeSet_state_check') THEN
    NULL;
  ELSIF EXISTS (SELECT 1 FROM "ChangeSet" WHERE "state" NOT IN ('draft', 'simulated', 'pending_approval', 'approved', 'executing', 'executed', 'failed', 'rolled_back', 'rejected')) THEN
    RAISE NOTICE 'ChangeSet.state: a row has a state the code does not know - the check is not added (fix the row, then add it)';
  ELSE
    ALTER TABLE "ChangeSet" ADD CONSTRAINT "ChangeSet_state_check" CHECK ("state" IN ('draft', 'simulated', 'pending_approval', 'approved', 'executing', 'executed', 'failed', 'rolled_back', 'rejected')) NOT VALID;
  END IF;
END
$$;
