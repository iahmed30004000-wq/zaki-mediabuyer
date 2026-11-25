/**
 * The hourly job: the WATCH of P10 with the safety stop back (D82). It runs through the REAL change service (simulate · level · execute · verify);
 * the database and the call to Meta are doubles. What is held here:
 *   • at the daily cap every running campaign is paused, above 1.75 × the planned budgets every running budget is cut 30%;
 *   • each at most once per account per Amman day (a failed one is tried again, three times in all), so a cut never compounds;
 *   • the alert says what really happened — a trial never reads as a stop;
 *   • a healthy day, stale data, fake orders and a missing cap change nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = new Date("2026-11-22T21:30:00Z"); // 00:30 Amman on the 23rd — UTC still says the 22nd
const later = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000);

type Row = Record<string, any>;

const s = vi.hoisted(() => ({
  now: new Date(0),
  fresh: true,
  accounts: [] as any[],
  orders: [] as any[],
  spend: {} as Record<string, number>,
  foreign: [] as any[],
  spendDates: [] as Date[],
  changes: [] as any[],
  items: [] as any[],
  alerts: [] as any[],
  ruleRuns: [] as any[],
  writeMode: "dry_run" as "dry_run" | "live",
  failIds: new Set<string>(),
  sent: [] as any[],
}));

vi.mock("@/server/db", () => {
  const sets = () => s.accounts.flatMap((a) => a.campaigns.flatMap((c: Row) => c.adsets.map((x: Row) => ({ ...x, campaign: { account: a } }))));
  const campaigns = () => s.accounts.flatMap((a) => a.campaigns.map((c: Row) => ({ ...c, account: a, ref: c })));
  const has = (cond: any, v: unknown) => (cond === undefined ? true : typeof cond === "object" && cond !== null && "in" in cond ? cond.in.includes(v) : typeof cond === "object" && cond !== null && "not" in cond ? v !== cond.not : cond === v);
  const since = (cond: any, v: Date) => !cond?.gte || v.getTime() >= cond.gte.getTime();
  const withItems = (c: Row | undefined) => (c ? { ...c, items: s.items.filter((i) => i.changeSetId === c.id) } : null);
  const changeMatches = (c: Row, w: Row = {}) => has(w.id, c.id) && has(w.state, c.state) && has(w.source, c.source) && has(w.sourceRef, c.sourceRef) && has(w.accountMetaId, c.accountMetaId) && has(w.writeMode, c.writeMode) && since(w.createdAt, c.createdAt);
  const patch = (list: Row[], metaId: string, data: Row) => list.filter((x) => x.metaId === metaId).forEach((x) => Object.assign(x, data));
  return {
    db: {
      attributedOrder: { findMany: async () => s.orders },
      adAccount: { findMany: async () => s.accounts, findUnique: async ({ where }: Row) => s.accounts.find((a) => a.metaId === where.metaId) ?? null },
      insightDaily: { aggregate: async ({ where }: Row) => (s.spendDates.push(where.date), { _sum: { spend: where.objectId.in.reduce((n: number, id: string) => n + (s.spend[id] ?? 0), 0) } }), findMany: async () => s.foreign },
      campaign: { findUnique: async ({ where }: Row) => campaigns().find((c) => c.metaId === where.metaId) ?? null, updateMany: async ({ where, data }: Row) => patch(s.accounts.flatMap((a) => a.campaigns), where.metaId, data) },
      adSet: { findUnique: async ({ where }: Row) => sets().find((x) => x.metaId === where.metaId) ?? null, updateMany: async ({ where, data }: Row) => patch(s.accounts.flatMap((a) => a.campaigns.flatMap((c: Row) => c.adsets)), where.metaId, data) },
      changeSet: {
        create: async ({ data }: Row) => {
          const id = `cs${s.changes.length + 1}`;
          const { items, ...row } = data;
          s.changes.push({ ...row, id, createdAt: s.now, executedAt: null, error: null });
          s.items.push(...items.create.map((i: Row, n: number) => ({ ...i, id: `${id}-${n}`, changeSetId: id, apiResponse: null, verifyResult: null, createdAt: s.now, updatedAt: s.now })));
          return { ...s.changes.at(-1) };
        },
        findMany: async ({ where }: Row) => s.changes.filter((c) => changeMatches(c, where)).map(withItems),
        updateMany: async ({ where, data }: Row) => {
          const hit = s.changes.filter((c) => changeMatches(c, where));
          hit.forEach((c) => Object.assign(c, data));
          return { count: hit.length };
        },
        findUniqueOrThrow: async ({ where }: Row) => withItems(s.changes.find((c) => c.id === where.id))!,
      },
      changeItem: {
        findMany: async ({ where }: Row) =>
          s.items
            .map((i) => ({ ...i, changeSet: s.changes.find((c) => c.id === i.changeSetId) }))
            .filter((i) => has(where.objectId, i.objectId) && has(where.op, i.op) && has(where.changeSetId, i.changeSetId) && since(where.updatedAt, i.updatedAt) && changeMatches(i.changeSet, where.changeSet)),
        update: async ({ where, data }: Row) => Object.assign(s.items.find((i) => i.id === where.id)!, data),
      },
      metaConnection: { findFirst: async () => null },
      freeze: { create: async () => {} },
      experiment: { findFirst: async () => null, updateMany: async () => {} },
      ruleRun: {
        findFirst: async ({ where }: Row) => s.ruleRuns.find((r) => r.rule === where.rule && has(where.targetId, r.targetId) && since(where.createdAt, r.createdAt)) ?? null,
        create: async ({ data }: Row) => void s.ruleRuns.push({ ...data, createdAt: s.now }),
      },
      alert: { create: async ({ data }: Row) => void s.alerts.push(data) },
    },
  };
});
vi.mock("@/server/settings", () => ({ getSetting: async () => 0.01 }));
vi.mock("@/server/money", () => ({ loadRates: async () => new Map() }));
vi.mock("@/server/audit", () => ({ audit: async () => {} }));
vi.mock("@/jobs/runner", () => ({ lastSuccess: async () => (s.fresh ? new Date(s.now.getTime() - 20 * 60_000) : null) }));
vi.mock("@/jobs/account-safety", () => ({ accountRestricted: async () => false }));
vi.mock("@/jobs/meta-sync", () => ({ metaToken: async () => "token" }));
vi.mock("@/meta/write", () => ({
  writeMode: () => s.writeMode,
  applyItem: async (draft: { objectId: string }) => (s.sent.push(draft), { response: {}, verified: !s.failIds.has(draft.objectId), readBack: {} }),
}));

import { runRules } from "@/jobs/rules-run";

const run = (at: Date = NOW) => ((s.now = at), runRules(at));

const set = (metaId: string, dailyBudget: number | null, ads: string[], status = "ACTIVE") => ({ metaId, status, dailyBudget, ads: ads.map((x) => ({ metaId: x })) });
const campaign = (metaId: string, adsets: ReturnType<typeof set>[], dailyBudget: number | null = null, status = "ACTIVE") => ({ metaId, status, dailyBudget, adsets });
/** One dollar account: C1 (an ad set of 60) and, already paused, C0. */
const acc = (over: Row = {}) => ({ metaId: "act_1", dailyCap: 100, currency: "USD", autonomyLevel: 1, campaigns: [campaign("C1", [set("S1", 60, ["AD1"])]), campaign("C0", [set("S0", 40, ["AD0"], "PAUSED")], null, "PAUSED")], ...over });
/** C1 (ad set budget 60) and C2 (campaign budget 40), no cap: the spike's account. */
const spiky = (over: Row = {}) => acc({ dailyCap: null, campaigns: [campaign("C1", [set("S1", 60, ["AD1"])]), campaign("C2", [set("S2", null, ["AD2"])], 40)], ...over });

const kinds = () => s.alerts.map((a) => a.kind);
const last = () => s.alerts.at(-1)!.text as string;
const capText = () => s.alerts.filter((a) => a.kind === "rule.daily_cap").at(-1)!.text as string;

beforeEach(() => Object.assign(s, { now: NOW, fresh: true, accounts: [], orders: [], spend: {}, foreign: [], spendDates: [], changes: [], items: [], alerts: [], ruleRuns: [], writeMode: "dry_run", failIds: new Set<string>(), sent: [] }));

describe("the hourly watch", () => {
  it("a healthy hour writes nothing", async () => {
    s.accounts = [acc()];
    s.spend = { AD1: 10 };
    expect(await run()).toMatchObject({ alerts: 0, changes: 0 });
    expect(s.alerts).toEqual([]);
    expect(s.changes).toEqual([]);
  });
  it("R-02: «today» is the Amman day (the 23rd at 00:30), not the UTC day that is still the 22nd", async () => {
    s.accounts = [acc()];
    await run();
    expect(s.spendDates[0]!.toISOString()).toBe("2026-11-23T00:00:00.000Z");
  });
  it("R-03: a campaign budget counts as planned, so a spend under it is not a spike", async () => {
    s.accounts = [spiky()];
    s.spend = { AD1: 100, AD2: 70 }; // 170 ≤ 1.75 × 100
    await run();
    expect(s.alerts).toEqual([]);
  });
  it("stale data is an alert, and changes nothing", async () => {
    s.fresh = false;
    s.accounts = [acc()];
    await run();
    expect(kinds()).toEqual(["rule.stale_data"]);
    expect(s.changes).toEqual([]);
  });
  it("fake orders on an ad are an alert", async () => {
    s.orders = [...Array.from({ length: 7 }, () => ({ adId: "AD9", isFake: false })), ...Array.from({ length: 3 }, () => ({ adId: "AD9", isFake: true }))];
    await run();
    expect(kinds()).toEqual(["rule.fake_orders"]);
    expect(s.changes).toEqual([]);
  });
  it("a cap typed as 0 is no cap: nothing is stopped", async () => {
    s.accounts = [acc({ dailyCap: 0 })];
    s.spend = { AD1: 5 };
    await run();
    expect(s.changes).toEqual([]);
    expect(s.alerts).toEqual([]);
  });
});

describe("the daily cap stops the account (D82)", () => {
  const atCap = () => {
    s.accounts = [acc()];
    s.spend = { AD1: 99.5 }; // × 1.01 = 100.495 ≥ 100
  };

  it("dry run: the running campaigns are put through as a pause, and the alert says nothing changed on Meta", async () => {
    atCap();
    expect(await run()).toMatchObject({ alerts: 1, changes: 1 });
    expect(s.changes[0]).toMatchObject({ source: "rule", sourceRef: "daily_cap", reasonCode: "S04", kind: "safety_pause", accountMetaId: "act_1", state: "executed", writeMode: "dry_run" });
    expect(s.items.map((i) => [i.op, i.objectId])).toEqual([["pause", "C1"]]);
    expect(last()).toContain("تجربة");
    expect(last()).toContain("ما تغيّر شي");
    expect(last()).not.toContain("وقّفت");
    expect(s.ruleRuns[0]).toMatchObject({ rule: "daily_cap", action: "pause", alertOnly: false, changeSetId: "cs1" });
  });
  it("the pause takes the campaign's budget off the day, so bringing it back is a raise", async () => {
    atCap();
    await run();
    expect(s.items[0]!.before).toEqual({ status: "ACTIVE", dailyBudget: 60 });
    expect(Number(s.changes[0]!.spendDeltaDaily)).toBe(-60);
  });
  it("another currency with no rate is stopped too, and no figure of it is written as dollars", async () => {
    s.accounts = [acc({ currency: "JOD" })];
    await run();
    expect(s.changes).toEqual([]); // the double reads foreign spend row by row: none today
    s.accounts = [acc({ currency: "JOD" })];
    s.foreign = [{ objectId: "AD1", spend: 150, currency: "JOD", source: "meta" }];
    await run();
    expect(s.items.map((i) => [i.op, i.objectId, i.before.dailyBudget])).toEqual([["pause", "C1", undefined]]);
    expect(Number(s.changes[0]!.spendDeltaDaily)).toBe(0);
  });
  it("live: paused on Meta, written into the site's copy, and said as it is", async () => {
    atCap();
    s.writeMode = "live";
    await run();
    expect(s.sent.map((d) => [d.op, d.objectId])).toEqual([["pause", "C1"]]);
    expect(s.accounts[0].campaigns[0].status).toBe("PAUSED");
    expect(last()).toContain("وقّفت 1 حملة");
    expect(last()).toContain("لحد ما ترجّعها إنت");
  });
  it("once a day: the next hours change nothing, and later it only reminds", async () => {
    atCap();
    await run();
    expect(await run(later(1))).toMatchObject({ alerts: 0, skipped: 1, changes: 0 });
    await run(later(13));
    expect(s.changes).toHaveLength(1);
    expect(last()).toContain("ما بعيده");
  });
  it("a new Amman day acts again, even inside the 12 hours of the reminder", async () => {
    atCap();
    await run(later(20)); // 20:30 Amman
    await run(later(25)); // 01:30 Amman, the next day
    expect(s.changes).toHaveLength(2);
  });
  it("what the owner brought back is not stopped again the same day", async () => {
    atCap();
    s.writeMode = "live";
    await run();
    s.changes[0]!.state = "rolled_back";
    s.accounts[0].campaigns[0].status = "ACTIVE";
    await run(later(13));
    expect(s.changes).toHaveLength(1);
    expect(s.accounts[0].campaigns[0].status).toBe("ACTIVE");
  });
  it("a «مستشار» account only gets the suggestion", async () => {
    atCap();
    s.accounts[0].autonomyLevel = 0;
    await run();
    expect(s.changes[0]!.state).toBe("simulated");
    expect(s.sent).toEqual([]);
    expect(last()).toContain("اقتراح بس");
  });
  it("a failed stop is tried again for what is left, three times in all, and says when it gives up", async () => {
    s.accounts = [acc({ campaigns: [campaign("C1", [set("S1", 60, ["AD1"])]), campaign("C2", [set("S2", 20, ["AD2"])])] })];
    s.spend = { AD1: 150 };
    s.writeMode = "live";
    s.failIds = new Set(["C2"]);
    await run();
    expect(capText()).toContain("1 من 2");
    expect(capText()).toContain("بجرّب كمان مرة");
    await run(later(1));
    await run(later(2));
    expect(s.sent.map((d) => d.objectId)).toEqual(["C1", "C2", "C2", "C2"]);
    expect(capText()).toContain("ما رح أجرّب مرة تانية");
    await run(later(3));
    expect(s.changes).toHaveLength(3);
  });
});

describe("a spend spike cuts the budgets 30% (D82)", () => {
  const spike = (over: Row = {}) => {
    s.accounts = [spiky(over)];
    s.spend = { AD1: 130, AD2: 50 }; // 180 > 1.75 × 100
  };

  it("every running budget, on the ad set and on the campaign", async () => {
    spike();
    await run();
    expect(s.changes[0]).toMatchObject({ sourceRef: "spend_spike", reasonCode: "S05", kind: "safety_reduce", state: "executed" });
    expect(s.items.map((i) => [i.objectType, i.objectId, i.before.dailyBudget, i.after.dailyBudget])).toEqual([["adset", "S1", 60, 42], ["campaign", "C2", 40, 28]]);
    expect(last()).toContain("أخفّض 2 ميزانية 30%");
  });
  it("never twice the same day: a cut does not feed the next one", async () => {
    spike();
    s.writeMode = "live";
    await run();
    expect(s.accounts[0].campaigns[0].adsets[0].dailyBudget).toBe(42);
    await run(later(7));
    await run(later(14));
    expect(s.changes).toHaveLength(1);
    expect(s.accounts[0].campaigns[0].adsets[0].dailyBudget).toBe(42);
  });
  it("Meta's own 1.75 × is not a spike (the card fee does not tip it over)", async () => {
    s.accounts = [spiky()];
    s.spend = { AD1: 105, AD2: 70 };
    await run();
    expect(s.alerts).toEqual([]);
  });
  it("spend of a paused ad set or of a lifetime budget is not compared with the daily budgets", async () => {
    s.accounts = [acc({ dailyCap: null, campaigns: [campaign("C1", [set("S1", 60, ["AD1"]), set("S9", 80, ["AD9"], "PAUSED"), set("SL", null, ["ADL"])])] })];
    s.spend = { AD1: 50, AD9: 200, ADL: 300 };
    await run();
    expect(s.alerts).toEqual([]);
    expect(s.changes).toEqual([]);
  });
  it("a budget lowered earlier today is read at its higher figure", async () => {
    s.accounts = [acc({ dailyCap: null, campaigns: [campaign("C1", [set("S1", 40, ["AD1"])])] })];
    s.spend = { AD1: 90 }; // above 1.75 × 40, under 1.75 × the 100 it was this morning
    s.changes = [{ id: "night", source: "rule", sourceRef: "adset_revert", accountMetaId: "act_1", state: "executed", writeMode: "live", createdAt: NOW }];
    s.items = [{ id: "n1", changeSetId: "night", op: "set_budget", objectType: "adset", objectId: "S1", before: { dailyBudget: 100 }, after: { dailyBudget: 40 }, verifyResult: { verified: true }, createdAt: NOW, updatedAt: NOW }];
    await run();
    expect(s.alerts).toEqual([]);
  });
  it("old Meta figures: an alert, no cut", async () => {
    spike();
    s.fresh = false;
    await run();
    expect(s.changes).toEqual([]);
    expect(s.alerts.find((a) => a.kind === "rule.spend_spike")!.text).toContain("متأخرة");
  });
  it("another currency: an alert, no cut", async () => {
    spike({ currency: "JOD" });
    await run();
    expect(s.changes).toEqual([]);
  });
  it("at the cap too: the stop decides, and nothing is cut", async () => {
    spike({ dailyCap: 100 });
    await run();
    expect(s.changes.map((c) => c.sourceRef)).toEqual(["daily_cap"]);
    expect(s.alerts.find((a) => a.kind === "rule.spend_spike")!.text).toContain("قرار السقف");
  });
});
