/**
 * MONEY IN ONE CURRENCY, from the rows to the figures (v6 · P11): the OMS pull (products in another currency, a code listed twice, a new product's market),
 * the truth of a day (dinars converted, a currency with no rate named, a product in two markets), the numbers screen, the ads table and the push of a day's
 * spend. The database and the settings are doubles; the arithmetic is the real one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, any>;
const s = vi.hoisted(() => ({
  rates: {} as Record<string, unknown>,
  conflicts: [] as unknown[],
  saved: [] as { key: string; value: unknown }[],
  econ: [] as Row[],
  accounts: [] as Row[],
  campaigns: [] as Row[],
  ads: [] as Row[],
  insights: [] as Row[],
  orders: [] as Row[],
  truth: [] as Row[],
  truthDeletes: [] as Row[],
  alerts: [] as Row[],
  pdays: [] as Row[],
  audits: [] as Row[],
}));

const flatten = () => s.insights.map((i) => ({ ...i, _sum: { spend: i.spend, impressions: i.impressions ?? 0, linkClicks: 0, purchases: 0 } }));
const distinct = (rows: Row[], by: string[]) => [...new Map(rows.map((r) => [by.map((k) => r[k]).join("|"), Object.fromEntries(by.map((k) => [k, r[k]]))])).values()].map((r) => ({ ...r, _count: { _all: 1 } }));

vi.mock("@/server/db", () => ({
  db: {
    productEconomics: {
      findMany: async () => s.econ,
      findUnique: async ({ where }: { where: Row }) => s.econ.find((e) => e.productCode === where.productCode) ?? null,
      upsert: async ({ where, create, update }: Row) => {
        const e = s.econ.find((x) => x.productCode === where.productCode);
        if (e) Object.assign(e, update);
        else s.econ.push({ ...create });
      },
      updateMany: async ({ where, data }: Row) => s.econ.filter((e) => e.productCode === where.productCode).forEach((e) => Object.assign(e, data)),
    },
    productAlias: { findMany: async () => [], upsert: async () => ({}) },
    adAccount: { findMany: async () => s.accounts },
    campaign: { findMany: async () => s.campaigns },
    adSet: { findMany: async () => [] },
    ad: { findMany: async () => s.ads },
    insightDaily: {
      findMany: async ({ where }: Row) => s.insights.filter((i) => !(where.date instanceof Date) || i.date.getTime() === where.date.getTime()),
      groupBy: async () => flatten(),
    },
    attributedOrder: {
      findMany: async ({ where }: Row) => s.orders.filter((o) => !where?.createdAtOms || (o.createdAtOms >= where.createdAtOms.gte && o.createdAtOms < where.createdAtOms.lt)),
      deleteMany: async () => ({ count: 0 }),
      upsert: async ({ create }: Row) => void s.orders.push(create),
      groupBy: async ({ by }: { by: string[] }) => distinct(s.orders, by),
    },
    truthDaily: { upsert: async ({ create }: Row) => void s.truth.push(create), deleteMany: async (q: Row) => void s.truthDeletes.push(q), findMany: async () => s.truth.filter((t) => t.spendMissing || t.moneyMissing) },
    alert: { create: async ({ data }: Row) => void s.alerts.push(data) },
    auditLog: { findFirst: async ({ where }: Row) => s.audits.find((a) => a.targetId === where.targetId) ?? null },
    productDay: { findMany: async () => s.pdays },
    stockSnapshot: { findMany: async () => [] },
  },
}));
vi.mock("@/server/settings", () => ({
  getSetting: async (key: string) =>
    key === "currency.rates" ? s.rates : key === "oms.product_conflicts" ? s.conflicts : key === "economics.fx_fee" ? 0 : key === "economics.overhead_factor" ? 1 : key === "truth.confirm_window_h" ? 24 : { targetCost: null, breakeven: {} },
  setSetting: async (key: string, value: unknown) => (s.saved.push({ key, value }), 1),
}));
vi.mock("@/server/redact", () => ({ forViewer: async <T>(v: T) => v }));

import { computeTruthDays, syncOms } from "@/jobs/truth";
import { loadNumbers, loadSeriesMany } from "@/lib/numbers-view";
import { assembleTable, type Source } from "@/lib/ads-table";
import { productMarketViews, type Dataset } from "@/core/ads-model";
import { parseRange } from "@/core/dates";

const D = (day: string) => new Date(`${day}T00:00:00Z`);
const DAY = "2026-11-20";
const NOW = new Date("2026-11-22T09:00:00Z");
const econ = (code: string, market = "SY") => ({ productCode: code, name: code, market, price: "20", unitCost: "2", deliveryFee: "1", returnFee: "0", codFeePct: "0", confirmCost: "0.3", stockDays: null, source: "actual" });
const campaign = (metaId: string, code: string, market: string, currency: string) => ({ metaId, productCode: code, parsedMarket: market, account: { market, currency } });
const adRow = (metaId: string, c: Row) => ({ metaId, name: metaId, adSet: { campaign: c } });
const spend = (objectId: string, amount: number, currency: string, day = DAY) => ({ level: "ad", objectId, date: D(day), spend: amount, currency, source: "api", impressions: 1000 });
const order = (id: string, code: string, market: string, currency: string, value: string, over: Row = {}) => ({ omsOrderId: id, productCode: code, market, currency, status: "delivered", orderValue: value, collected: value, adId: null, createdAtOms: new Date(`${DAY}T10:00:00Z`), matureAt: D("2026-11-21"), isFake: false, method: "ad_id", ...over });
const truthOf = (level: string, id: string) => s.truth.find((t) => t.level === level && t.objectId === id)!;

beforeEach(() => {
  Object.assign(s, { rates: {}, conflicts: [], saved: [], econ: [econ("TRF01")], accounts: [], campaigns: [], ads: [], insights: [], orders: [], truth: [], truthDeletes: [], alerts: [], pdays: [], audits: [] });
});

const world = (currency: string, market = "SY") => {
  const c = campaign("C1", "TRF01", market, currency);
  s.campaigns = [c];
  s.ads = [adRow("AD1", c)];
  s.accounts = [{ metaId: "act_1", currency, campaigns: [{ metaId: "C1", adsets: [{ metaId: "S1", ads: [{ metaId: "AD1" }] }] }] }];
};

describe("the truth of a day", () => {
  it("dinar orders and dinar spend are converted before they are added: never dinars read as dollars", async () => {
    s.econ = [econ("TRF01", "JO")];
    world("JOD", "JO");
    s.insights = [spend("AD1", 7.09, "JOD")];
    s.orders = [order("1", "TRF01", "JO", "JOD", "14.18", { adId: "AD1" }), order("2", "TRF01", "JO", "USD", "10.00")];
    await computeTruthDays(D(DAY), D(DAY), NOW);
    const p = truthOf("product", "TRF01");
    expect(p.spendWithFee).toBe("10");
    // 14.18 JOD = 20$, + 10$ − 2 × (1$ delivery) = 28$
    expect(p.netCollected).toBe("28");
    expect([p.spendMissing, p.moneyMissing]).toEqual([null, null]);
    expect(truthOf("ad", "AD1").netCollected).toBe("19");
  });

  it("an order in a currency with no rate: the revenue and the profit are unknown and named; the spend still stands", async () => {
    world("USD");
    s.insights = [spend("AD1", 10, "USD")];
    s.orders = [order("1", "TRF01", "SY", "USD", "20.00", { adId: "AD1" }), order("2", "TRF01", "SY", "SYP", "2500.00")];
    await computeTruthDays(D(DAY), D(DAY), NOW);
    const p = truthOf("product", "TRF01");
    expect(p).toMatchObject({ spendWithFee: "10", spendMissing: null, moneyMissing: "fx:SYP", netCollected: "0", profitAfterCosts: "0", scalingCeiling: null, trueRoas: null, orders: 2, delivered: 2 });
    // the ad has no SYP order of its own: its figures are whole
    expect(truthOf("ad", "AD1").moneyMissing).toBeNull();
  });

  it("an undelivered order in that currency brings no money, so nothing is missing", async () => {
    world("USD");
    s.orders = [order("1", "TRF01", "SY", "SYP", "2500.00", { status: "confirmed", collected: null })];
    await computeTruthDays(D(DAY), D(DAY), NOW);
    expect(truthOf("product", "TRF01").moneyMissing).toBeNull();
  });

  it("spend with no rate: no cost per confirmed, no profit — and once the owner writes the rate, whole figures", async () => {
    world("EGP", "EG");
    s.econ = [econ("TRF01", "EG")];
    s.insights = [spend("AD1", 500, "EGP")];
    s.orders = [order("1", "TRF01", "EG", "USD", "20.00", { adId: "AD1" })];
    await computeTruthDays(D(DAY), D(DAY), NOW);
    expect(truthOf("product", "TRF01")).toMatchObject({ spendMissing: "fx:EGP", spendWithFee: "0", costPerConfirmed: null, profitAfterCosts: "0", netCollected: "19" });
    s.truth = [];
    s.rates = { EGP: { perUsd: 50, at: "x" } };
    await computeTruthDays(D(DAY), D(DAY), NOW);
    expect(truthOf("product", "TRF01")).toMatchObject({ spendMissing: null, spendWithFee: "10", costPerConfirmed: "10", profitAfterCosts: "7" });
  });

  it("a product in two markets gets a row per market; the other market's money is not worked out with the home's prices", async () => {
    const home = campaign("C1", "TRF01", "SY", "USD");
    const other = campaign("C2", "TRF01", "JO", "USD");
    s.campaigns = [home, other];
    s.ads = [adRow("AD1", home), adRow("AD2", other)];
    s.accounts = [{ metaId: "act_1", currency: "USD", campaigns: [] }];
    s.insights = [spend("AD1", 10, "USD"), spend("AD2", 4, "USD")];
    s.orders = [order("1", "TRF01", "SY", "USD", "20.00"), order("2", "TRF01", "JO", "JOD", "7.09")];
    await computeTruthDays(D(DAY), D(DAY), NOW);
    expect(truthOf("product", "TRF01")).toMatchObject({ spendWithFee: "10", orders: 1, netCollected: "19", moneyMissing: null });
    expect(truthOf("product", "TRF01@JO")).toMatchObject({ spendWithFee: "4", orders: 1, moneyMissing: "market", netCollected: "0", scalingCeiling: null });
    // the older merged rows of that day step aside
    expect(s.truthDeletes).toHaveLength(1);
  });
});

describe("the OMS pull", () => {
  const product = (code: string, over: Row = {}) => ({ code, name: code, currency: "USD", price_options: [{ price: "20.00" }], ...over });
  const wire = (id: string, code: string, country: string, currency: string) => ({ order_id: id, product_code: code, country, channel: "website", status: "new", created_at: `${DAY}T10:00:00+03:00`, order_value: "10.00", currency });
  const fake = (products: Row[], orders: Row[]) => (async (url: string) => new Response(JSON.stringify(String(url).includes("/products") ? { items: products } : { items: orders, next_cursor: null }))) as unknown as typeof fetch;
  const pull = (products: Row[], orders: Row[] = []) => syncOms({ baseUrl: "http://oms.test", token: "t", fetch: fake(products, orders) }, D("2026-11-19"));

  it("a code listed twice with different figures is not taken, an alert says so once, and the list is kept", async () => {
    s.econ = [];
    const r = await pull([product("TRF01"), product("TRF01", { currency: "JOD", price_options: [{ price: "9.00" }] }), product("TIN01")]);
    expect(s.econ.map((e) => e.productCode)).toEqual(["TIN01"]);
    expect(r.conflicts).toBe(1);
    expect(s.alerts).toHaveLength(1);
    expect(s.alerts[0]!.text).toContain("TRF01");
    expect(s.saved[0]).toMatchObject({ key: "oms.product_conflicts" });
    // seen again: no second alert, nothing rewritten
    s.conflicts = s.saved[0]!.value as unknown[];
    s.saved = [];
    await pull([product("TRF01"), product("TRF01", { currency: "JOD" })]);
    expect(s.alerts).toHaveLength(1);
    expect(s.saved).toEqual([]);
  });

  it("the same code in two countries is stored, and said", async () => {
    await pull([product("TRF01")], [wire("1", "TRF01", "SY", "USD"), wire("2", "TRF01", "JO", "JOD")]);
    expect(s.orders).toHaveLength(2);
    expect(s.alerts.map((a) => a.kind)).toEqual(["oms.product_conflict"]);
  });

  it("a product still on the old «SY» default takes the one market its orders show; one the owner saved or placed is never rewritten", async () => {
    s.econ = [econ("TRF01"), econ("TIN01", "LY")];
    s.audits = [{ targetId: "TRF01" }];
    await pull([product("NEW01", { currency: "JOD" }), product("TRF01"), product("TIN01")], [wire("1", "NEW01", "JO", "JOD"), wire("2", "TRF01", "EG", "USD"), wire("3", "TIN01", "EG", "USD")]);
    expect(Object.fromEntries(s.econ.map((e) => [e.productCode, e.market]))).toEqual({ NEW01: "JO", TRF01: "SY", TIN01: "LY" });
  });

  it("one with orders in Syria too, or in two other countries, stays as it is", async () => {
    await pull([product("TRF01"), product("TIN01")], [wire("1", "TRF01", "SY", "USD"), wire("2", "TRF01", "EG", "USD"), wire("3", "TIN01", "EG", "USD"), wire("4", "TIN01", "JO", "JOD")]);
    expect(s.econ.map((e) => e.market)).toEqual(["SY", "SY"]);
  });

  it("an older row whose prices are in a currency with no rate is marked, whatever it still holds — and the mark goes once the rate is there", async () => {
    // before this phase the row was written with 5000 pounds read as dollars
    s.econ = [{ ...econ("TRF01"), price: "5000" }];
    await pull([product("TRF01", { currency: "SYP", price_options: [{ price: "5000.00" }] })]);
    expect(s.econ[0]).toMatchObject({ moneyMissing: "SYP", price: "5000" });
    s.rates = { SYP: { perUsd: 100, at: "x" } };
    await pull([product("TRF01", { currency: "SYP", price_options: [{ price: "5000.00" }] })]);
    expect(s.econ[0]).toMatchObject({ moneyMissing: null, price: "50" });
  });

  it("nothing works money out with a marked product: no profit in the truth, the numbers or the ads", async () => {
    s.econ = [{ ...econ("TRF01"), price: "5000", moneyMissing: "SYP" }];
    world("USD");
    s.insights = [spend("AD1", 10, "USD")];
    s.orders = [order("1", "TRF01", "SY", "USD", "20.00", { adId: "AD1" })];
    await computeTruthDays(D(DAY), D(DAY), NOW);
    expect(truthOf("product", "TRF01")).toMatchObject({ spendMissing: null, moneyMissing: "fx:SYP", profitAfterCosts: "0", scalingCeiling: null });
    s.pdays = [{ productCode: "TRF01", date: D(DAY), shippedOrders: 2, shippedPieces: 2, revenueShipped: 40, delivered: 1, returned: 0 }];
    const n = await loadNumbers({ d: "custom", from: DAY, to: DAY }, NOW);
    expect(n.missingRates).toEqual(["SYP"]);
    expect([n.products[0]!.current.expectedProfit, n.totals.current.expectedProfit]).toEqual([null, null]);
  });

  it("a currency with no rate is reported by the pull", async () => {
    s.econ = [];
    const r = await pull([product("TRF01", { currency: "LYD" })]);
    expect(r.missingRates).toEqual(["LYD"]);
    expect(s.econ[0]!.price).toBe("0");
  });
});

describe("the numbers screen", () => {
  const range = { d: "custom", from: DAY, to: DAY };

  it("spend in two currencies is added in dollars", async () => {
    s.campaigns = [campaign("C1", "TRF01", "SY", "USD"), campaign("C2", "TIN01", "JO", "JOD")];
    s.insights = [spend("C1", 10, "USD"), spend("C2", 7.09, "JOD")].map((i) => ({ ...i, level: "campaign" }));
    const n = await loadNumbers(range, NOW);
    expect(n.totals.current.spend).toBe(20);
    expect(n.missingRates).toEqual([]);
  });

  it("spend with no rate: that product and the total are «—», the currency is named, the other product stands", async () => {
    s.campaigns = [campaign("C1", "TRF01", "SY", "USD"), campaign("C2", "TIN01", "EG", "EGP")];
    s.insights = [spend("C1", 10, "USD"), spend("C2", 500, "EGP")].map((i) => ({ ...i, level: "campaign" }));
    const n = await loadNumbers(range, NOW);
    expect(n.missingRates).toEqual(["EGP"]);
    expect(n.totals.current.spend).toBeNull();
    expect(n.products.find((p) => p.code === "TRF01")!.current.spend).toBe(10);
    expect(n.products.find((p) => p.code === "TIN01")!).toMatchObject({ hasData: true, current: { spend: null } });
    // the line has a gap on that day, and the figure once the owner writes the rate
    expect((await loadSeriesMany(["spend"], { days: 3, now: NOW })).spend).toEqual([null, null, null]);
    s.rates = { EGP: { perUsd: 50, at: "x" } };
    expect((await loadSeriesMany(["spend"], { days: 3, now: NOW })).spend).toEqual([null, 20, null]);
  });

  it("a delivered order with no rate is named too", async () => {
    s.orders = [order("1", "TRF01", "SY", "SYP", "2500.00")];
    expect((await loadNumbers(range, NOW)).missingRates).toEqual(["SYP"]);
  });

  it("a product in two markets is two lines, and the market filter keeps one", async () => {
    s.campaigns = [campaign("C1", "TRF01", "SY", "USD"), campaign("C2", "TRF01", "JO", "USD")];
    s.insights = [spend("C1", 10, "USD"), spend("C2", 4, "USD")].map((i) => ({ ...i, level: "campaign" }));
    s.orders = [order("1", "TRF01", "SY", "USD", "20"), order("2", "TRF01", "JO", "JOD", "7"), order("3", "TRF01", "JO", "JOD", "7")];
    const n = await loadNumbers(range, NOW);
    expect(n.products.map((p) => [p.key, p.code, p.market, p.current.spend, p.current.ordersIn])).toEqual([["TRF01", "TRF01", "SY", 10, 1], ["TRF01@JO", "TRF01", "JO", 4, 2]]);
    expect(n.products[1]!.name).toContain("الأردن");
    const jo = await loadNumbers({ ...range, market: "JO" }, NOW);
    expect(jo.products.map((p) => p.key)).toEqual(["TRF01@JO"]);
    expect(jo.totals.current).toMatchObject({ spend: 4, ordersIn: 2 });
    expect((await loadNumbers({ ...range, market: "EG" }, NOW)).products).toEqual([]);
    expect((await loadNumbers({ ...range, market: "nonsense" }, NOW)).products).toHaveLength(2);
  });

  it("two markets are two lines even when the window shows one of them: the same answer the truth gives", async () => {
    s.campaigns = [];
    // the Syrian order is months old; only Jordan sold in this window
    s.orders = [order("0", "TRF01", "SY", "USD", "20", { createdAtOms: D("2026-05-01") }), order("1", "TRF01", "JO", "JOD", "7")];
    const n = await loadNumbers({ d: "custom", from: DAY, to: DAY }, NOW);
    expect(n.products.map((p) => [p.key, p.market])).toEqual([["TRF01@JO", "JO"]]);
  });

  it("a pushed day of a product in two markets is not added on top of one of them, and it is said", async () => {
    s.orders = [order("1", "TRF01", "SY", "USD", "20"), order("2", "TRF01", "JO", "JOD", "7")];
    s.pdays = [{ productCode: "TRF01", date: D(DAY), spend: 99, ordersIn: 50 }];
    const n = await loadNumbers(range, NOW);
    expect(n.totals.current.ordersIn).toBe(2);
    expect(n.totals.current.spend).toBeNull();
    expect(n.unplacedPushed).toEqual(["TRF01"]);
  });
});

describe("the ads table", () => {
  const source = (insights: Source["insights"], markets: [string, string] = ["SY", "SY"]): Source => ({
    demo: false,
    products: [{ code: "TRF01", name: "كمأة", market: "SY", price: 20, unitCost: 2, delivery: 1, returnFee: 0, codFee: 0, confirmCost: 0.3, stockDays: 5, shipmentsToDate: 60 }],
    campaigns: markets.map((market, i) => ({ id: `c${i}`, name: `c${i}`, status: "active", market, productCode: "TRF01", stage: "TEST", namingOk: true, budget: null, start: null, adsets: [] })),
    insights,
    orders: [{ adId: null, adSetId: null, campaignId: "c1", day: DAY, status: "confirmed", matureAt: 0, messaging: false }],
  });
  const row = (id: string, spendUsd: number, fxMissing?: string) => ({ level: "campaign" as const, id, day: DAY, spend: spendUsd, impressions: 100, clicks: 1, purchases: 0, v3s: 0, thru: 0, conversations: 0, frequency: 1, ...(fxMissing ? { fxMissing } : {}) });
  const table = (src: Source) => assembleTable(src, parseRange({ d: "custom", from: DAY, to: DAY }, NOW), NOW, { fx: 0, testLimit: 0.2, stepPct: 0.2, target: null, breakeven: () => 5, rulesMissing: false });

  it("a row with spend that has no rate shows no money — and is not judged; the test share is unknown", () => {
    const t = table(source([row("c0", 10), row("c1", 0, "EGP")]));
    const bad = t.rows.find((r) => r.id === "c1")!;
    expect([bad.m.spend, bad.m.costPerOrder, bad.m.profit, bad.m.cpm, bad.spendToday]).toEqual([null, null, null, null, null]);
    expect(bad.m.orders).toBe(1);
    expect(bad.missingRates).toEqual(["EGP"]);
    // the table's calculator adds the card fee of 1% (src/core/ads-model.ts)
    expect(t.rows.find((r) => r.id === "c0")!.m.spend).toBe(10.1);
    expect(t.missingRates).toEqual(["EGP"]);
    expect(t.share.share).toBeNull();
  });

  it("a campaign of the product's other market says its market and has no profit from the home's prices", () => {
    const t = table(source([row("c0", 10), row("c1", 10)], ["SY", "JO"]));
    const other = t.rows.find((r) => r.id === "c1")!;
    expect(other.product).toEqual({ code: "TRF01", name: "كمأة — الأردن" });
    expect(other.m.profit).toBeNull();
    expect(other.tOrder).toBeNull();
    expect(t.rows.find((r) => r.id === "c0")!.m.profit).not.toBeNull();
    expect(t.products).toEqual([{ code: "TRF01", name: "كمأة" }]);
  });

  it("«حسب المنتج» is a line per market", () => {
    const counts = { spend: 10, impressions: 10, clicks: 1, v3s: 0, thru: 0, purchases: 0, orders: 2, mature: 2, confirmed: 1, shipments: 1, delivered: 1, returned: 0 };
    const camp = (id: string, market: string) => ({ id, account: "a", name: id, productCode: "TRF01", status: "active" as const, market, adsets: [{ id: `${id}s`, name: "s", status: "active" as const, dailyBudget: 1, learning: { events: 0, of: 50 }, ads: [{ id: `${id}a`, name: "a", status: "active" as const, counts }] }] });
    const ds: Dataset = { demo: false, products: source([]).products, accounts: [], campaigns: [camp("x", "SY"), camp("y", "EG")] };
    const v = productMarketViews(ds);
    expect(v.map((x) => [x.key, x.name, x.view.spend, x.targets === null])).toEqual([["TRF01", "كمأة — سوريا", 10.1, false], ["TRF01@EG", "كمأة — مصر", 10.1, true]]);
    expect(v[1]!.view.profit).toBeNull();
    // prices with no rate: no line has money from them, and the spend still stands
    const marked = productMarketViews({ ...ds, products: ds.products.map((p) => ({ ...p, moneyMissing: "SYP" })) });
    expect(marked.map((x) => [x.view.spend, x.view.profit, x.view.ceiling, x.targets])).toEqual([[10.1, null, null, null], [10.1, null, null, null]]);
  });
});
