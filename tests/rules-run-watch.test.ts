/**
 * The hourly job after P10 is a WATCH: it reads the Amman day's spend, the planned budgets (ad sets AND campaigns), the age of the data and the fake orders, and writes
 * ALERTS. It never proposes a change, never freezes, and the same alert is not repeated inside its cooldown. The database is a double.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-22T21:30:00Z"); // 00:30 Amman on the 23rd — UTC still says the 22nd
const s = vi.hoisted(() => ({
  fresh: true,
  accounts: [] as Record<string, unknown>[],
  orders: [] as Record<string, unknown>[],
  spendQueries: [] as { date: Date }[],
  spendOfToday: 0,
  alerts: [] as Record<string, unknown>[],
  ruleRuns: [] as Record<string, unknown>[],
  recent: false,
}));

vi.mock("@/server/db", () => ({
  db: {
    attributedOrder: { findMany: async () => s.orders },
    adAccount: { findMany: async () => s.accounts },
    insightDaily: { aggregate: async (q: { where: { date: Date } }) => (s.spendQueries.push({ date: q.where.date }), { _sum: { spend: s.spendOfToday } }) },
    ruleRun: { findFirst: async () => (s.recent ? { id: "r" } : null), create: async ({ data }: { data: Record<string, unknown> }) => void s.ruleRuns.push(data) },
    alert: { create: async ({ data }: { data: Record<string, unknown> }) => void s.alerts.push(data) },
  },
}));
vi.mock("@/server/settings", () => ({ getSetting: async () => 0.01 }));
vi.mock("@/jobs/runner", () => ({ lastSuccess: async () => (s.fresh ? new Date(NOW.getTime() - 20 * 60_000) : null) }));
vi.mock("@/server/changes", () => ({
  propose: async () => {
    throw new Error("the hourly watch must never propose a change");
  },
}));

import { runRules } from "@/jobs/rules-run";

const acc = (over: Record<string, unknown> = {}) => ({ metaId: "act_1", dailyCap: 100, campaigns: [{ status: "ACTIVE", dailyBudget: null, adsets: [{ status: "ACTIVE", dailyBudget: 60, ads: [{ metaId: "AD1" }] }] }], ...over });

beforeEach(() => Object.assign(s, { fresh: true, accounts: [], orders: [], spendQueries: [], spendOfToday: 0, alerts: [], ruleRuns: [], recent: false }));

describe("the hourly watch", () => {
  it("a healthy hour writes nothing", async () => {
    s.accounts = [acc()];
    s.spendOfToday = 10;
    expect(await runRules(NOW)).toMatchObject({ alerts: 0 });
    expect(s.alerts).toEqual([]);
  });
  it("R-02: «today» is the Amman day (the 23rd at 00:30), not the UTC day that is still the 22nd", async () => {
    s.accounts = [acc()];
    await runRules(NOW);
    expect(s.spendQueries[0]!.date.toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });
  it("R-02: the spend gets the fee, and reaching the cap is an alert — never a pause, never a freeze", async () => {
    s.accounts = [acc()];
    s.spendOfToday = 99.5; // × 1.01 = 100.495 ≥ 100
    await runRules(NOW);
    expect(s.alerts).toEqual([expect.objectContaining({ kind: "rule.daily_cap", tone: "danger" })]);
    expect(s.ruleRuns[0]).toMatchObject({ rule: "daily_cap", action: "alert", alertOnly: true, changeSetId: null });
  });
  it("R-03: a campaign budget counts as planned, so a spend under it is not a spike", async () => {
    s.accounts = [acc({ dailyCap: null, campaigns: [{ status: "ACTIVE", dailyBudget: 300, adsets: [{ status: "ACTIVE", dailyBudget: null, ads: [{ metaId: "AD1" }] }] }] })];
    s.spendOfToday = 290;
    await runRules(NOW);
    expect(s.alerts).toEqual([]);
  });
  it("a spend of twice the plan is a spike alert", async () => {
    s.accounts = [acc({ dailyCap: null })];
    s.spendOfToday = 120; // ×1.01 = 121.2 > 1.75 × 60
    await runRules(NOW);
    expect(s.alerts.map((a) => a.kind)).toEqual(["rule.spend_spike"]);
  });
  it("stale data is an alert (and no freeze row is written — the night round itself refuses stale data)", async () => {
    s.fresh = false;
    s.accounts = [acc()];
    await runRules(NOW);
    expect(s.alerts.map((a) => a.kind)).toEqual(["rule.stale_data"]);
  });
  it("fake orders on an ad are an alert", async () => {
    s.orders = [...Array.from({ length: 7 }, () => ({ adId: "AD9", isFake: false })), ...Array.from({ length: 3 }, () => ({ adId: "AD9", isFake: true }))];
    await runRules(NOW);
    expect(s.alerts.map((a) => a.kind)).toEqual(["rule.fake_orders"]);
  });
  it("the same alert inside its cooldown is not written again", async () => {
    s.accounts = [acc()];
    s.spendOfToday = 99.5;
    s.recent = true;
    expect(await runRules(NOW)).toMatchObject({ alerts: 0, skipped: 1 });
    expect(s.alerts).toEqual([]);
  });
});
