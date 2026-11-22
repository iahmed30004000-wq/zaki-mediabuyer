/**
 * HOW LONG THE TABLES THAT GROW KEEP THEIR ROWS — pure (docs/rebuild-v6/00-audit.md N-14). The weekly clean-up asks here for the cut-off of each. The
 * newest good run of every job is always kept (the site says «آخر مرة نجحت» from it), and a job's own runs and the team's decisions are never cleaned.
 */
export const RETENTION_DAYS = {
  /** the worker's own slot rows */
  jobRun: 30,
  /** one audit row per tool call: the only kind that is cleaned */
  mcpCall: 90,
  /** an authorization code is good for minutes; the row of an expired one is dead after a day */
  oauthCode: 1,
} as const;

export const AUDIT_ACTION_CLEANED = "mcp.call";

const DAY = 86_400_000;
export interface Cutoffs {
  jobRun: Date;
  mcpCall: Date;
  oauthCode: Date;
}

export function cleanupCutoffs(now: Date): Cutoffs {
  return {
    jobRun: new Date(now.getTime() - RETENTION_DAYS.jobRun * DAY),
    mcpCall: new Date(now.getTime() - RETENTION_DAYS.mcpCall * DAY),
    oauthCode: new Date(now.getTime() - RETENTION_DAYS.oauthCode * DAY),
  };
}
