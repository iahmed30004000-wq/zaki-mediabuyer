/**
 * WHAT MAY BE DECIDED when currencies and markets are in play (v6 · P11, D80): nothing is judged or raised on money that is not dollars or has no rate; the
 * return stop is judged market by market; a code that means two products stops nothing and raises nothing; no amount is written into a foreign account; and the
 * launch never takes «the first account». The database and the change service are doubles.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_RULES, type CampaignRules } from "@/core/rules-v2";

const NOW = new Date("2026-11-22T21:40:00Z"); // 00:40 Amman, 23 Nov
type Row = Record<string, any>;
const s = vi.hoisted(() => ({
  rules: null as unknown as CampaignRules,
  rates: {} as Record<string, unknown>,
  conflicts: [] as unknown[],
  accounts: [] as Row[],
  adsets: [] as Row[],
  campaigns: [] as Row[],
  insights: [] as Row[],
  orders: [] as Row[],
  counts: [] as Row[],
  created: [] as Row[],
  currency: "USD",
}));

vi.mock("@/server/db", () => ({
  db: {
    adAccount: { findMany: async () => s.accounts, findUnique: async () => ({ currency: s.currency, autonomyLevel: 1, dailyCap: 100, campaigns: [] }) },
    insightDaily: { findMany: async () => s.insights },
    attributedOrder: { findMany: async () => s.orders, groupBy: async () => s.counts },
    changeItem: { findMany: async () => [] },
    changeSet: { create: async (q: Row) => (s.created.push(q), { id: "cs1" }) },
    campaign: { findMany: async () => s.campaigns, findUnique: async () => ({ account: { metaId: "act_1" } }) },
    adSet: { findMany: async () => s.adsets, findUnique: async () => ({ campaign: { account: { metaId: "act_1" } } }) },
    freeze: { findMany: async () => [] },
    productEconomics: { findUnique: async () => ({ stockDays: 30 }) },
    ruleRun: { findFirst: async () => null },
  },
}));
vi.mock("@/server/settings", () => ({ getSetting: async (k: string) => (k === "currency.rates" ? s.rates : k === "oms.product_conflicts" ? s.conflicts : 0) }));
vi.mock("@/server/rules", () => ({ getRules: async () => ({ rules: s.rules }) }));
vi.mock("@/agents/monitor", () => ({ explainSafety: async () => undefined }));
vi.mock("@/jobs/runner", () => ({ lastSuccess: async () => new Date(NOW.getTime() - 35 * 60_000) }));
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));
vi.mock("@/server/auth", () => ({ HttpError: class extends Error { constructor(public status: number, message: string) { super(message); } } }));

import { accountChoices, accountProblem, type LaunchAccount } from "@/core/launch-guard";
import { foreignMoneyBlock } from "@/core/rulebook";
import { evaluateScale, type ScaleFacts } from "@/core/scale";
import { watchAccount } from "@/core/rules";
import { itemsFor, planNight } from "@/jobs/night-round";
import { gatherScale } from "@/jobs/scale-run";
import { propose } from "@/server/changes";

const DAYS = ["2026-11-20", "2026-11-21", "2026-11-22"];
const rules = (over: Partial<CampaignRules> = {}): CampaignRules => ({ ...DEFAULT_RULES, breakeven: { TRF01: 5 }, scale: { ...DEFAULT_RULES.scale, maxCost: 6.5, stepPct: 0.25, maxWeekPct: 0.6, everyHours: 48, days: 3, minConfirmed: 5 }, ...over });

beforeEach(() => {
  Object.assign(s, { rules: rules(), rates: {}, conflicts: [], accounts: [], adsets: [], campaigns: [], insights: [], orders: [], counts: [], created: [], currency: "USD" });
});

describe("the night round", () => {
  const ad = (metaId: string) => ({ metaId, name: metaId, status: "ACTIVE", startTime: null, createdAt: new Date("2026-10-01T00:00:00Z") });
  const account = () => ({ metaId: "act_1", currency: "USD", market: "SY", campaigns: [{ status: "ACTIVE", productCode: "TRF01", parsedMarket: "SY", startTime: null, dailyBudget: null, adsets: [{ metaId: "AS1", name: "x", status: "ACTIVE", dailyBudget: 30, startTime: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"), ads: [ad("AD1"), ad("AD2")] }] }] });
  const spendRows = (currency: string) => DAYS.map((d) => ({ objectId: "AD1", date: new Date(`${d}T00:00:00Z`), spend: 900, purchases: 1, currency, source: "import" }));

  it("spend that has no rate is never read as dollars: the ad set is held, the currency named, nothing proposed", async () => {
    s.accounts = [account()];
    s.insights = spendRows("EGP");
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([]);
    expect(p.held).toContainEqual({ targetId: "AS1", level: "adset", why: "ناقص سعر صرف: EGP" });
  });

  it("with the rate, the same rows are judged on their dollar value", async () => {
    s.accounts = [account()];
    s.insights = spendRows("EGP");
    s.rates = { EGP: { perUsd: 900, at: "x" } }; // 900 EGP = 1$ a day, one purchase: under the break-even
    expect((await planNight(NOW)).decisions).toEqual([]);
    s.rates = { EGP: { perUsd: 50, at: "x" } }; // 18$ a day: above it
    expect((await planNight(NOW)).decisions.map((d) => d.rule)).toContain("adset_above_breakeven");
  });

  const count = (market: string, status: string, n: number) => ({ productCode: "TRF01", market, status, _count: { _all: n } });

  it("the return stop of a product in two markets is judged market by market, and stops that market's campaigns only", async () => {
    // Jordan returns far above his share; Syria is clean — folded together they would pass under it
    s.counts = [count("SY", "delivered", 40), count("JO", "delivered", 6), count("JO", "returned", 6)];
    const p = await planNight(NOW);
    expect(p.decisions).toHaveLength(1);
    expect(p.decisions[0]).toMatchObject({ rule: "high_return", targetId: "TRF01@JO" });
    expect(p.decisions[0]!.sentence).toContain("الأردن");
    const c = (metaId: string, market: string) => ({ metaId, status: "ACTIVE", productCode: "TRF01", parsedMarket: market, dailyBudget: null, account: { market: null } });
    s.campaigns = [c("C-SY", "SY"), c("C-JO", "JO")];
    expect((await itemsFor(p.decisions[0]!)).map((i) => i.objectId)).toEqual(["C-JO"]);
  });

  it("a campaign whose market nobody knows is stopped with the failing market, and the sentence says so — never one of another market", async () => {
    s.counts = [count("SY", "delivered", 40), count("JO", "delivered", 6), count("JO", "returned", 6)];
    const unnamed = { status: "ACTIVE", productCode: "TRF01", parsedMarket: null, startTime: null, dailyBudget: null, adsets: [] };
    s.accounts = [{ metaId: "act_9", currency: "USD", market: null, campaigns: [unnamed] }];
    const p = await planNight(NOW);
    expect(p.decisions[0]!.sentence).toContain("سوقها مش معروف");
    s.campaigns = [{ ...unnamed, metaId: "C-NONE", account: { market: null } }, { ...unnamed, metaId: "C-SY", parsedMarket: "SY", account: { market: null } }];
    expect((await itemsFor(p.decisions[0]!)).map((i) => i.objectId)).toEqual(["C-NONE"]);
  });

  it("a code the catalogue lists as two products: no return stop on the mix — held, with the reason", async () => {
    s.counts = [count("SY", "delivered", 10), count("SY", "returned", 10)];
    expect((await planNight(NOW)).decisions).toHaveLength(1);
    s.conflicts = [{ code: "TRF01", kind: "catalogue", text: "x" }];
    const p = await planNight(NOW);
    expect(p.decisions).toEqual([]);
    expect(p.held[0]!.why).toContain("متضارب");
  });
});

describe("the scale ladder", () => {
  const adset = (currency: string) => ({ metaId: "AS1", name: "x", status: "ACTIVE", dailyBudget: 40, lastSignificantEditAt: null, startTime: new Date("2026-10-01T00:00:00Z"), createdAt: new Date("2026-10-01T00:00:00Z"), ads: [{ metaId: "AD1" }], campaign: { status: "ACTIVE", stage: "SCALE", productCode: "TRF01", parsedMarket: "SY", account: { metaId: "act_1", currency, market: "SY" } } });
  const winner = (currency = "USD") => {
    s.insights = DAYS.map((d) => ({ date: new Date(`${d}T00:00:00Z`), spend: 20, currency, source: "api" }));
    s.orders = DAYS.flatMap((d) => Array.from({ length: 5 }, () => ({ createdAtOms: new Date(`${d}T00:30:00+03:00`), status: "confirmed", market: "SY", matureAt: new Date("2026-11-01T00:00:00Z") })));
  };

  it("a proven winner on a dollar account is raised", async () => {
    winner();
    s.adsets = [adset("USD")];
    expect((await gatherScale(NOW))[0]!.decision.raise).toBe(true);
  });
  it("the same figures on a dinar account are not: before this, 20 dinars read as 20 dollars", async () => {
    winner("JOD");
    s.adsets = [adset("JOD")];
    const row = (await gatherScale(NOW))[0]!;
    expect(row.decision).toMatchObject({ raise: false });
    expect(row.decision.blockers).toEqual([expect.stringContaining("JOD")]);
    expect(row.unit).toBe("JOD");
  });
  it("spend with no rate blocks the raise", async () => {
    winner("EGP");
    s.adsets = [adset("USD")];
    expect((await gatherScale(NOW))[0]!.decision.blockers).toEqual(["ناقص سعر صرف: EGP"]);
  });
  it("his cap on the running products cannot be checked while another account's budget has no rate", async () => {
    winner();
    s.adsets = [adset("USD")];
    s.rules = rules({ scale: { ...rules().scale, capRunning: 500 } });
    s.campaigns = [{ status: "ACTIVE", stage: "SCALE", productCode: "X", dailyBudget: 900, adsets: [], account: { currency: "EGP", market: "EG" } }];
    expect((await gatherScale(NOW))[0]!.decision.blockers[0]).toContain("ناقص سعر صرف: EGP");
    s.rates = { EGP: { perUsd: 50, at: "x" } };
    expect((await gatherScale(NOW))[0]!.decision.raise).toBe(true);
  });
  it("a code the catalogue lists as two products is not raised", async () => {
    winner();
    s.adsets = [adset("USD")];
    s.conflicts = [{ code: "TRF01", kind: "catalogue", text: "x" }];
    expect((await gatherScale(NOW))[0]!.decision.blockers[0]).toContain("متضارب");
  });
  it("a money block is the only thing said", () => {
    const f = { adSetId: "A", moneyBlock: "ناقص سعر صرف: EGP" } as ScaleFacts;
    expect(evaluateScale(f)).toMatchObject({ raise: false, newBudget: null, blockers: ["ناقص سعر صرف: EGP"] });
  });
});

describe("what may be written into an account of another currency", () => {
  const item = (op: string) => ({ op });
  it("dollars: everything; unknown currency: left to the cap check", () => {
    expect(foreignMoneyBlock("USD", [item("create")])).toBeNull();
    expect(foreignMoneyBlock(undefined, [item("set_budget")])).toBeNull();
  });
  it("no create, no account cap, no budget change — a cut typed in dollars would be written in the account's currency", () => {
    for (const op of ["create", "set_account_cap", "set_budget"]) expect(foreignMoneyBlock("JOD", [item(op)])).toContain("JOD");
  });
  it("a stop and a switch back on pass", () => {
    expect(foreignMoneyBlock("JOD", [item("pause"), item("resume")])).toBeNull();
  });
  it("the change service refuses a cut too, and a budget hidden behind another account's name", async () => {
    s.currency = "JOD";
    const cut = { source: "agent" as const, reasonCode: "S11", sentence: "x", kind: "safety_reduce" as const, items: [{ op: "set_budget" as const, objectType: "adset" as const, objectId: "AS1", before: { dailyBudget: 14 }, after: { dailyBudget: 10 } }] };
    await expect(propose(cut, { type: "agent", id: "M04" })).rejects.toThrow("JOD");
    await expect(propose({ ...cut, accountMetaId: "act_usd" }, { type: "agent", id: "M04" })).rejects.toThrow("JOD");
    expect(s.created).toEqual([]);
  });
  it("the change service refuses the raise before anything is stored — with or without the account named", async () => {
    s.currency = "JOD";
    const raise = { source: "user" as const, reasonCode: "S11", sentence: "x", kind: "raise_step" as const, items: [{ op: "set_budget" as const, objectType: "adset" as const, objectId: "AS1", before: { dailyBudget: 10 }, after: { dailyBudget: 12 } }] };
    await expect(propose({ ...raise, accountMetaId: "act_1" }, { type: "user", id: "u" })).rejects.toThrow("JOD");
    await expect(propose(raise, { type: "agent", id: "M04" })).rejects.toThrow("JOD");
    expect(s.created).toEqual([]);
  });
  it("the watch writes a foreign figure with its currency, never with a «$»", () => {
    const [a] = watchAccount({ accountId: "act_1", spendToday: 120, budgetedSpend: 120, dailyCap: 100, hourSpend: 0, avgHourSpend7d: 0, dailyBudgetsSum: 100, dataAgeHours: 0, unit: "EGP" });
    expect(a!.sentence).toContain("120.00 EGP");
    expect(a!.sentence).not.toContain("$");
  });
});

describe("the launch's ad account is never «the first one»", () => {
  const a = (metaId: string, market: string | null, currency = "USD"): LaunchAccount => ({ metaId, name: metaId, market, currency });
  it("one account of the market: preselected", () => expect(accountChoices([a("jo", "JO"), a("sy", "SY")], "SY")).toMatchObject({ preselected: "sy", options: [{ metaId: "sy" }] }));
  it("two of the same market: the owner picks", () => {
    const c = accountChoices([a("sy1", "SY"), a("sy2", "SY")], "SY");
    expect(c.preselected).toBeNull();
    expect(c.options.map((x) => x.metaId)).toEqual(["sy1", "sy2"]);
  });
  it("none of the market and several unset: the owner picks", () => expect(accountChoices([a("x", null), a("y", null)], "SY").preselected).toBeNull());
  it("the only account there is, with no market: preselected", () => expect(accountChoices([a("x", null)], "SY").preselected).toBe("x"));
  it("the one of the market wins over unset ones, which stay pickable", () => expect(accountChoices([a("x", null), a("sy", "SY")], "SY")).toMatchObject({ preselected: "sy", options: [{ metaId: "sy" }, { metaId: "x" }] }));
  it("another market's account, or another currency's, is never offered — and it says what to do", () => {
    const c = accountChoices([a("jo", "JO"), a("sy-jod", "SY", "JOD")], "SY");
    expect(c).toMatchObject({ preselected: null, options: [] });
    expect(c.none).toContain("سوريا");
    expect(accountProblem(a("jo", "JO"), "SY")).toContain("الأردن");
    expect(accountProblem(a("sy-jod", "SY", "JOD"), "SY")).toContain("JOD");
    expect(accountChoices([], "SY").none).toBe("ما في حساب إعلاني مربوط");
  });
});
