-- v6 · P1-1 (docs/rebuild-v6/01-model.md §3): the run, the queue and the decisions learn who, when and until when.
-- Additive only: every column is optional or has a default, nothing is dropped, renamed or retyped, and the app keeps working
-- (and keeps reading) without any of them. Only three statements touch rows: the «الموقع» actor, who carries out each job, and the end of a request nobody took.

-- AlterTable
ALTER TABLE "Actor" ADD COLUMN     "lastSeenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Approval" ADD COLUMN     "actedAt" TIMESTAMP(3),
ADD COLUMN     "nodeId" TEXT,
ADD COLUMN     "runRef" TEXT;

-- AlterTable
ALTER TABLE "Handoff" ADD COLUMN     "claimNonce" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "leaseUntil" TIMESTAMP(3),
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Workflow" ADD COLUMN     "assigneeKey" TEXT,
ADD COLUMN     "graceMin" INTEGER NOT NULL DEFAULT 15,
ADD COLUMN     "maxRunMin" INTEGER NOT NULL DEFAULT 90,
ADD COLUMN     "mergedInto" TEXT,
ADD COLUMN     "notifyOn" TEXT[] DEFAULT ARRAY['missed', 'stuck', 'failed']::TEXT[],
ADD COLUMN     "ownerEdited" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "recipe" TEXT,
ADD COLUMN     "recipeParams" JSONB,
ADD COLUMN     "scheduleChangedAt" TIMESTAMP(3),
ADD COLUMN     "wake" TEXT NOT NULL DEFAULT 'self';

-- AlterTable
ALTER TABLE "WorkflowRun" ADD COLUMN     "doneBy" TEXT,
ADD COLUMN     "endReason" TEXT,
ADD COLUMN     "graphVersion" INTEGER,
ADD COLUMN     "heartbeatAt" TIMESTAMP(3),
ADD COLUMN     "scheduledFor" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_scheduledFor_idx" ON "WorkflowRun"("workflowId", "scheduledFor");

-- The site is an actor too (it carries out the jobs that are its own, and writes «فاتت» / «انقطعت»). Keyed like the others; never overwrites one that exists.
INSERT INTO "Actor" ("id", "key", "name", "kind", "team", "telegram", "updatedAt")
VALUES ('actor_site', 'site', 'الموقع', 'agent', NULL, NULL, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- Who carries out each job, from what it already says: the Claude executors are «claude», Hermes and Muse keep their keys, what the site itself
-- carries out (n8n, an HTTP address, Telegram, the system) is «site», and a job for a person takes the first person its steps name — when that
-- person is in the directory. No key is invented for anybody: what cannot be told stays empty (and the queue falls back to «claude», as before).
UPDATE "Workflow" w
SET "assigneeKey" = CASE
  WHEN w."executor" IN ('claude_mcp', 'claude_task', 'claude_desktop', 'claude_api') THEN 'claude'
  WHEN w."executor" = 'hermes' THEN 'hermes'
  WHEN w."executor" = 'muse' THEN 'muse'
  WHEN w."executor" IN ('n8n', 'http', 'telegram', 'system') THEN 'site'
  WHEN w."executor" = 'person' THEN (
    SELECT ac."key" FROM jsonb_array_elements(w."graph" -> 'nodes') AS n JOIN "Actor" ac ON ac."key" = n ->> 'assignee' LIMIT 1
  )
  ELSE NULL
END
WHERE w."assigneeKey" IS NULL;

-- A «شغّلها هلأ» request that nobody took used to wait forever (one sat 49 minutes with no one on it). From now a manual request ends after
-- 6 hours, so the ones already waiting get the same ending, counted from when they were asked.
UPDATE "Handoff" SET "expiresAt" = "createdAt" + INTERVAL '6 hours'
WHERE "status" = 'open' AND "kind" = 'manual_run' AND "expiresAt" IS NULL;
