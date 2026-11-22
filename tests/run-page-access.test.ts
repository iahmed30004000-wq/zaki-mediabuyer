/**
 * The page of one run (v6 · P3) reads by role, like the results screen: the result (summary · report · numbers · links) needs the area of the job, the money numbers need
 * `money.view`, and the decisions waiting on its steps need the inbox — a role that opens an ads job's run with `work.view` alone sees the rope and nothing of the money.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { canReadRunResult, canSeeRunApproval, runMetricsFor } from "@/core/run-access";
import { ROLES, type RoleKey } from "@/core/roles";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/reports", () => ({ loadReports: async () => [] }));
vi.mock("@/server/directory", () => ({ directoryNames: async () => ({ claude: "كلود" }) }));
vi.mock("@/lib/day-view", () => ({ loadDay: async () => null }));
vi.mock("@/lib/jobs-view", () => ({ loadJobs: async () => [] }));

import { loadRunPage } from "@/lib/tasks-view";

const NOW = new Date("2026-11-22T10:00:00.000Z");
const METRICS = { spend: 100, revenue: 300, net_profit: 120, profit_margin: 0.4 };

async function seed(domain: "ads" | "ops") {
  const key = `${domain}-job`;
  const wf = await h.db.workflow.create({ data: jobRow(key, ["s1"], { domain }) });
  const run = await h.db.workflowRun.create({
    data: { workflowId: wf.id, ref: "r1", status: "done", startedAt: new Date("2026-11-22T09:00:00Z"), finishedAt: new Date("2026-11-22T09:05:00Z"), summary: "صرفنا 100 وربحنا 120", report: "تقرير كامل فيه الأرباح", metrics: METRICS, artifacts: [{ label: "ملف", url: "https://x.test/f" }], nodeStates: { s1: { status: "approval" } } },
  });
  await h.db.approval.create({ data: { ref: "a1", title: "زيادة صرف", why: "الربح عالي", workflowKey: key, runRef: "r1", nodeId: "s1", amount: 50, numbers: [{ label: "الربح", value: "120" }], options: [] } });
  return { key, runId: run.id as string };
}

beforeEach(() => {
  h.db.workflow.rows.length = 0;
  h.db.workflowRun.rows.length = 0;
  h.db.approval.rows.length = 0;
});

describe("the helpers", () => {
  it("the result needs the area of the job; a job or a test (role null) reads everything", () => {
    expect(canReadRunResult(null, "ads")).toBe(true);
    expect(canReadRunResult("ADS_MANAGER", "ads")).toBe(true);
    expect(canReadRunResult("ADS_MANAGER", "ops")).toBe(false);
    expect(canReadRunResult("OPS_MANAGER", "ops")).toBe(true);
    expect(canReadRunResult("OPS_MANAGER", "ads")).toBe(false);
    expect(canReadRunResult("TEAM_LEAD", "ads")).toBe(false);
    expect(canReadRunResult("VIEWER", "ads")).toBe(true);
  });

  it("money keys leave the numbers without money.view, and only they", () => {
    for (const role of ROLES as readonly RoleKey[]) {
      const m = runMetricsFor(role, METRICS);
      const money = role === "OWNER" || role === "MANAGER" || role === "ADS_MANAGER" || role === "ANALYST";
      expect("net_profit" in (m ?? {})).toBe(money);
      expect("profit_margin" in (m ?? {})).toBe(money);
      expect(m?.spend).toBe(100);
    }
    expect(runMetricsFor("VIEWER", null)).toBeNull();
    expect(runMetricsFor(null, METRICS)).toEqual(METRICS);
  });

  it("a decision is seen only by a role whose inbox holds its area", () => {
    expect(canSeeRunApproval(null, "ads")).toBe(true);
    expect(canSeeRunApproval("OWNER", "work")).toBe(true);
    for (const role of ["TEAM_LEAD", "VIEWER", "MEMBER", "ANALYST"] as const) expect(canSeeRunApproval(role, "work")).toBe(false);
  });
});

describe("loadRunPage by role", () => {
  it("OWNER and ADS_MANAGER read the whole run of an ads job: result, every number, the decision", async () => {
    const { key, runId } = await seed("ads");
    for (const role of ["OWNER", "ADS_MANAGER"] as const) {
      const d = await loadRunPage(key, runId, role, NOW);
      expect(d?.resultHidden).toBe(false);
      expect(d?.run.report).toBe("تقرير كامل فيه الأرباح");
      expect(d?.run.summary).toBe("صرفنا 100 وربحنا 120");
      expect(d?.run.metrics).toEqual(METRICS);
      expect(d?.run.artifacts).toHaveLength(1);
      expect(d?.approvals).toHaveLength(1);
      expect(d?.steps[0]?.approvalId).toBeTruthy();
    }
  });

  it("a job or a test (role null) reads the real values", async () => {
    const { key, runId } = await seed("ads");
    const d = await loadRunPage(key, runId, null, NOW);
    expect(d?.run.metrics).toEqual(METRICS);
    expect(d?.approvals).toHaveLength(1);
  });

  it("OPS_MANAGER opening an ads job: the rope yes, the result and the money no", async () => {
    const { key, runId } = await seed("ads");
    const d = await loadRunPage(key, runId, "OPS_MANAGER", NOW);
    expect(d).not.toBeNull();
    expect(d?.steps).toHaveLength(1);
    expect(d?.resultHidden).toBe(true);
    expect(d?.run.report).toBeNull();
    expect(d?.run.summary).toBeNull();
    expect(d?.run.metrics).toBeNull();
    expect(d?.run.artifacts).toEqual([]);
    expect(d?.approvals).toEqual([]); // its inbox holds «الشغل», but the decision carries the numbers of an area that is not its own
    expect(d?.steps[0]?.approvalId).toBeNull();
    expect(JSON.stringify(d)).not.toContain("120");
  });

  it("TEAM_LEAD opening an ads job: no result, no money, no decision", async () => {
    const { key, runId } = await seed("ads");
    const d = await loadRunPage(key, runId, "TEAM_LEAD", NOW);
    expect(d).not.toBeNull();
    expect(d?.resultHidden).toBe(true);
    expect(d?.run.report).toBeNull();
    expect(d?.run.metrics).toBeNull();
    expect(d?.approvals).toEqual([]);
    expect(d?.steps[0]?.approvalId).toBeNull();
    expect(JSON.stringify(d)).not.toContain("زيادة صرف");
  });

  it("VIEWER opening an ads job: the result without money keys, and no decision", async () => {
    const { key, runId } = await seed("ads");
    const d = await loadRunPage(key, runId, "VIEWER", NOW);
    expect(d).not.toBeNull();
    expect(d?.resultHidden).toBe(false);
    expect(d?.run.metrics).toEqual({ spend: 100, revenue: 300 });
    expect(d?.approvals).toEqual([]);
    expect(d?.steps[0]?.approvalId).toBeNull();
    expect(JSON.stringify(d?.run.metrics)).not.toMatch(/profit|margin/);
  });

  it("the same roles on an ops job: OPS_MANAGER reads it, TEAM_LEAD reads it, ADS_MANAGER does not", async () => {
    const { key, runId } = await seed("ops");
    expect((await loadRunPage(key, runId, "OPS_MANAGER", NOW))?.resultHidden).toBe(false);
    expect((await loadRunPage(key, runId, "TEAM_LEAD", NOW))?.resultHidden).toBe(false);
    expect((await loadRunPage(key, runId, "ADS_MANAGER", NOW))?.resultHidden).toBe(true);
    expect((await loadRunPage(key, runId, "TEAM_LEAD", NOW))?.run.metrics).toEqual({ spend: 100, revenue: 300 });
  });
});
