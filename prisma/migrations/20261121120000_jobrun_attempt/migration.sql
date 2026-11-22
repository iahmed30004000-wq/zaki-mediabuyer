-- A failed slot of an internal job can be tried again (src/jobs/runner.ts). Additive only: a default fills the existing rows.
ALTER TABLE "JobRun" ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 1;
