import { describe, expect, it } from "vitest";
import { outcomeSentence, watchAccount, watchAd } from "@/core/rules";
import { effectiveLevel, modeFor, type ActionKind } from "@/core/autonomy";
import { canMove, flipFlopped, simulate, spendDeltaDaily, type ChangeItemDraft } from "@/core/changeset";

/** The hourly watch: it finds, it never says what was done — what the job did about a finding is tests/rules-run-watch.test.ts (D82). */
describe("the hourly watch: the finding, not the action", () => {
  const base = { accountId: "act_1", spendToday: 100, budgetedSpend: 100, dailyCap: 260, hourSpend: 5, avgHourSpend7d: 4, dailyBudgetsSum: 200, dataAgeHours: 0.5 };
  it("a healthy account raises nothing", () => expect(watchAccount(base)).toEqual([]));
  it("the daily cap is an alert (danger), and it does not say anything was stopped", () => {
    const [a] = watchAccount({ ...base, spendToday: 260 });
    expect(a).toMatchObject({ rule: "daily_cap", tone: "danger", level: "account" });
    expect(a!.sentence).not.toMatch(/وقّفت|خفّضت|جمّدت/);
  });
  it("a spending hour far above the usual is a spike", () => {
    const out = watchAccount({ ...base, hourSpend: 13 });
    expect(out.map((x) => x.rule)).toEqual(["spend_spike"]);
    expect(out[0]!.sentence).not.toMatch(/وقّفت|خفّضت|جمّدت/);
  });
  it("a day above 1.75 × the planned budgets is a spike", () => expect(watchAccount({ ...base, budgetedSpend: 360, dailyCap: null }).map((x) => x.rule)).toEqual(["spend_spike"]));
  it("stale data is an alert that says the night round will wait", () => {
    const out = watchAccount({ ...base, dataAgeHours: 3 });
    expect(out.map((x) => x.rule)).toEqual(["stale_data"]);
    expect(out[0]!.sentence).toContain("جولة الليل");
  });
  it("fake orders: 30% of at least 10 is an alert, below it nothing", () => {
    expect(watchAd({ adId: "a1", orders: 10, fakeOrders: 3 })[0]).toMatchObject({ rule: "fake_orders", level: "ad" });
    expect(watchAd({ adId: "a1", orders: 10, fakeOrders: 2 })).toEqual([]);
    expect(watchAd({ adId: "a1", orders: 9, fakeOrders: 9 })).toEqual([]);
  });
});

describe("what was done is said as it happened (D82)", () => {
  const done = (state: string, writeMode = "live") => ({ state, writeMode, done: 2, total: 2 });
  it("«وقّفت» only for a live, executed stop", () => {
    expect(outcomeSentence("daily_cap", done("executed"))).toContain("وقّفت 2 حملة");
    for (const o of [done("executed", "dry_run"), done("simulated"), done("pending_approval"), done("failed")]) expect(outcomeSentence("daily_cap", o)).not.toMatch(/وقّفت/);
    expect(outcomeSentence("spend_spike", done("executed", "dry_run"))).not.toMatch(/خفّضت/);
    expect(outcomeSentence("spend_spike", done("executed"))).toContain("30%");
  });
});

describe("autonomy (spec 10.1), cell by cell", () => {
  const T: Record<ActionKind, string[]> = {
    safety_pause: ["suggest", "auto", "auto", "auto"],
    safety_reduce: ["suggest", "auto", "auto", "auto"],
    resume: ["suggest", "approval", "approval", "auto"],
    raise_step: ["suggest", "approval", "auto", "auto"],
    new_ad: ["suggest", "approval", "approval", "auto"],
    test_campaign: ["suggest", "approval", "approval", "auto"],
    customer_audience: ["suggest", "approval", "approval", "approval"],
    above_cap: ["suggest", "owner", "owner", "owner"],
    connect_asset: ["owner", "owner", "owner", "owner"],
    safety_net: ["owner", "owner", "owner", "owner"],
  };
  for (const [kind, row] of Object.entries(T) as [ActionKind, string[]][]) {
    it(kind, () => expect([0, 1, 2, 3].map((l) => modeFor(kind, l as 0 | 1 | 2 | 3))).toEqual(row));
  }
  it("a raise at level 1 waits for approval", () => expect(modeFor("raise_step", 1)).toBe("approval"));
  it("any alarm drops the account to level 0", () => {
    expect(effectiveLevel(2, { sourceDown: true, bigGap: false, accountHealthAlert: false, tokenExpired: false })).toEqual({ level: 0, why: "مصدر بيانات واقف" });
    expect(effectiveLevel(2, { sourceDown: false, bigGap: false, accountHealthAlert: false, tokenExpired: false })).toEqual({ level: 2, why: null });
  });
});

describe("change sets (spec 10.2)", () => {
  it("only the allowed moves", () => {
    expect(canMove("pending_approval", "approved")).toBe(true);
    expect(canMove("draft", "executed")).toBe(false);
    expect(canMove("executed", "rolled_back")).toBe(true);
    expect(canMove("rolled_back", "executed")).toBe(false);
  });

  const raise: ChangeItemDraft = { op: "set_budget", objectType: "adset", objectId: "s1", before: { dailyBudget: 40 }, after: { dailyBudget: 48 } };
  const ctx = { plannedDaily: 189.6, dailyCap: 350, hoursSinceSignificant: { s1: 100 }, busyObjects: new Set<string>(), safety: false };

  it("the money a change moves", () => {
    expect(spendDeltaDaily([raise])).toBe(8);
    expect(spendDeltaDaily([{ op: "pause", objectType: "adset", objectId: "s1", before: { dailyBudget: 25 }, after: {} }])).toBe(-25);
  });
  it("simulating changes nothing and reports every check", () => {
    const sim = simulate([raise], ctx);
    expect(sim).toMatchObject({ ok: true, spendDeltaDaily: 8 });
    expect(sim.checks.map((c) => c.key)).toEqual(["cap", "learning", "conflict"]);
  });
  it("no raise without a known cap, none over the cap", () => {
    expect(simulate([raise], { ...ctx, dailyCap: null }).ok).toBe(false);
    expect(simulate([raise], { ...ctx, plannedDaily: 345 }).ok).toBe(false);
  });
  it("the learning guard blocks a significant edit within 72 h, but not safety", () => {
    const big: ChangeItemDraft = { ...raise, after: { dailyBudget: 60 } };
    expect(simulate([big], { ...ctx, hoursSinceSignificant: { s1: 20 } }).ok).toBe(false);
    expect(simulate([big], { ...ctx, hoursSinceSignificant: { s1: 20 }, safety: true, plannedDaily: 0 }).checks.find((c) => c.key === "learning")!.ok).toBe(true);
  });
  it("the loop guard: two flips in 48 h freeze", () => {
    const now = new Date("2026-10-26T12:00:00Z");
    const h = (hoursAgo: number, direction: "up" | "down") => ({ at: new Date(now.getTime() - hoursAgo * 3_600_000), direction });
    expect(flipFlopped([h(40, "down"), h(20, "up"), h(2, "down")], now)).toBe(true);
    expect(flipFlopped([h(40, "down"), h(20, "up")], now)).toBe(false);
    expect(flipFlopped([h(60, "down"), h(20, "up"), h(2, "down")], now)).toBe(false);
  });
});

describe("the cap is the sum of the budgets, not today's spend so far (R-08)", () => {
  const raise: ChangeItemDraft = { op: "set_budget", objectType: "adset", objectId: "s1", before: { dailyBudget: 40 }, after: { dailyBudget: 48 } };
  const ctx = { plannedDaily: 340, dailyCap: 350, hoursSinceSignificant: {}, busyObjects: new Set<string>(), safety: false };
  it("the budgets already planned plus the raise must fit the cap", () => {
    expect(simulate([raise], ctx).ok).toBe(true); // 340 + 8 = 348 ≤ 350
    expect(simulate([raise], { ...ctx, plannedDaily: 342 }).checks.find((c) => c.key === "cap")!.ok).toBe(true);
    expect(simulate([raise], { ...ctx, plannedDaily: 343 }).checks.find((c) => c.key === "cap")!.ok).toBe(false);
  });
  it("an unknown account fails closed: a raise is never let through when the base is not known", () => {
    const sim = simulate([raise], { ...ctx, plannedDaily: null });
    expect(sim.ok).toBe(false);
    expect(sim.checks.find((c) => c.key === "cap")!.note).toContain("الحساب مش معروف");
  });
  it("a cut needs no cap, known or not", () => {
    const cut: ChangeItemDraft = { op: "set_budget", objectType: "adset", objectId: "s1", before: { dailyBudget: 40 }, after: { dailyBudget: 28 } };
    expect(simulate([cut], { ...ctx, plannedDaily: null, dailyCap: null }).checks.find((c) => c.key === "cap")!.ok).toBe(true);
  });
});

describe("a safety stop is not held back by another change on the same object (R-19)", () => {
  const pause: ChangeItemDraft = { op: "pause", objectType: "campaign", objectId: "c1", before: { status: "ACTIVE" }, after: { status: "PAUSED" } };
  const ctx = { plannedDaily: 0, dailyCap: 100, hoursSinceSignificant: {}, busyObjects: new Set(["c1"]), safety: true };
  it("busy object + safety → the conflict check passes (and says why)", () => {
    const c = simulate([pause], ctx).checks.find((x) => x.key === "conflict")!;
    expect(c.ok).toBe(true);
    expect(c.note).toContain("الإيقاف بيمرّ");
  });
  it("busy object + not safety → it still conflicts", () => expect(simulate([pause], { ...ctx, safety: false }).checks.find((x) => x.key === "conflict")!.ok).toBe(false));
});
