-- A report with nothing in it is saved with this mark: it is not sent to Telegram and not listed (src/core/report-empty.ts). Additive only: a default fills the existing rows.
ALTER TABLE "Report" ADD COLUMN "empty" BOOLEAN NOT NULL DEFAULT false;
