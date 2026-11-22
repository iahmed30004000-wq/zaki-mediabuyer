/**
 * The weekly clean-up (docs/rebuild-v6/00-audit.md N-14): the tables that grow are trimmed by fixed cut-offs, and what a person decided or a job's own history
 * is never in it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AUDIT_ACTION_CLEANED, RETENTION_DAYS, cleanupCutoffs } from "@/core/retention";

const h = vi.hoisted(() => ({ db: null as any }));
vi.mock("@/server/db", async () => {
  const { makeTable } = await import("./helpers/fake-db");
  const clock = () => new Date();
  h.db = {
    jobRun: makeTable(() => ({ status: "ok", finishedAt: null }), [["job", "slot"]], clock),
    auditLog: makeTable(() => ({}), [], clock),
    oAuthCode: makeTable(() => ({}), [], clock),
    workflowRun: makeTable(() => ({}), [], clock),
    approval: makeTable(() => ({}), [], clock),
  };
  return { db: h.db };
});

import { weeklyCleanup } from "@/jobs/cleanup";

const NOW = new Date("2026-11-22T04:00:00.000Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe("the cut-offs — pure", () => {
  it("30 days for the worker's slots, 90 for the audit row of a tool call, a day for an expired code", () => {
    expect(RETENTION_DAYS).toEqual({ jobRun: 30, mcpCall: 90, oauthCode: 1 });
    expect(AUDIT_ACTION_CLEANED).toBe("mcp.call");
    const c = cleanupCutoffs(NOW);
    expect(c.jobRun).toEqual(ago(30));
    expect(c.mcpCall).toEqual(ago(90));
    expect(c.oauthCode).toEqual(ago(1));
  });
});

describe("weeklyCleanup", () => {
  beforeEach(() => {
    for (const t of Object.values(h.db) as { rows: unknown[] }[]) t.rows.length = 0;
  });

  it("deletes the worker's old slots but keeps the newest good one of every job, however old, and everything recent", async () => {
    await h.db.jobRun.create({ data: { job: "meta.sync", slot: "a", status: "ok", startedAt: ago(100), finishedAt: ago(100) } });
    await h.db.jobRun.create({ data: { job: "meta.sync", slot: "b", status: "ok", startedAt: ago(60), finishedAt: ago(60) } }); // the newest good one of meta.sync: stays
    await h.db.jobRun.create({ data: { job: "meta.sync", slot: "c", status: "failed", startedAt: ago(45), finishedAt: ago(45) } });
    await h.db.jobRun.create({ data: { job: "meta.sync", slot: "d", status: "failed", startedAt: ago(2), finishedAt: ago(2) } });
    await h.db.jobRun.create({ data: { job: "db.backup", slot: "a", status: "ok", startedAt: ago(31), finishedAt: ago(31) } }); // its only good one: stays
    await h.db.jobRun.create({ data: { job: "alerts.send", slot: "a", status: "failed", startedAt: ago(40), finishedAt: ago(40) } }); // never ok, old: goes
    const r = await weeklyCleanup(NOW);
    expect(r.jobRuns).toBe(3);
    expect(h.db.jobRun.rows.map((x: any) => `${x.job}/${x.slot}`).sort()).toEqual(["db.backup/a", "meta.sync/b", "meta.sync/d"]);
  });

  it("trims only the audit rows of tool calls older than 90 days: every other kind of audit row stays", async () => {
    await h.db.auditLog.create({ data: { actorType: "agent", action: "mcp.call", createdAt: ago(91) } });
    await h.db.auditLog.create({ data: { actorType: "agent", action: "mcp.call", createdAt: ago(10) } });
    await h.db.auditLog.create({ data: { actorType: "user", action: "setting.set", createdAt: ago(400) } });
    await h.db.auditLog.create({ data: { actorType: "user", action: "changeset.approve", createdAt: ago(200) } });
    const r = await weeklyCleanup(NOW);
    expect(r.mcpCalls).toBe(1);
    expect(h.db.auditLog.rows.map((x: any) => x.action).sort()).toEqual(["changeset.approve", "mcp.call", "setting.set"]);
  });

  it("removes the authorization codes that expired more than a day ago, and no live one", async () => {
    await h.db.oAuthCode.create({ data: { codeHash: "old", expiresAt: ago(2) } });
    await h.db.oAuthCode.create({ data: { codeHash: "recent", expiresAt: new Date(NOW.getTime() - 3_600_000) } });
    await h.db.oAuthCode.create({ data: { codeHash: "live", expiresAt: new Date(NOW.getTime() + 600_000) } });
    const r = await weeklyCleanup(NOW);
    expect(r.oauthCodes).toBe(1);
    expect(h.db.oAuthCode.rows.map((x: any) => x.codeHash).sort()).toEqual(["live", "recent"]);
  });

  it("never touches the runs of a job or the owner's decisions, whatever their age", async () => {
    await h.db.workflowRun.create({ data: { ref: "old", startedAt: ago(500) } });
    await h.db.approval.create({ data: { title: "قرار قديم", createdAt: ago(500) } });
    await weeklyCleanup(NOW);
    expect(h.db.workflowRun.rows).toHaveLength(1);
    expect(h.db.approval.rows).toHaveLength(1);
  });

  it("an empty database is a clean-up of nothing", async () => {
    expect(await weeklyCleanup(NOW)).toEqual({ jobRuns: 0, mcpCalls: 0, oauthCodes: 0 });
  });
});
