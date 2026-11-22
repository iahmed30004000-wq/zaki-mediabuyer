-- v6 · P7 — the phone's notices. Additions only: every new column is optional or has a default, nothing is dropped, renamed or retyped, and a second run of
-- the statements is harmless (IF NOT EXISTS). Old rows keep working: a notice without a `kind` is told by its colour.
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "kind" TEXT;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "ring" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "channels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "nextTryAt" TIMESTAMP(3);
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "lastError" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_sentAt_nextTryAt_idx" ON "Notification"("sentAt", "nextTryAt");

ALTER TABLE "PushDevice" ADD COLUMN IF NOT EXISTS "platform" TEXT;
ALTER TABLE "PushDevice" ADD COLUMN IF NOT EXISTS "failedAt" TIMESTAMP(3);
