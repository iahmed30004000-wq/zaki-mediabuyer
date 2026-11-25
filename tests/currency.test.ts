/**
 * MONEY IN ONE CURRENCY and ONE PRODUCT IN SEVERAL MARKETS (v6 · P11) — the pure rules: rates and conversion, what a stored row's currency is, what the owner
 * may save, what a paste or a file says about its currency, the lines of a product seen in two markets, the codes that say two things, and the money of a truth row.
 */
import { describe, expect, it } from "vitest";
import { BASE_CURRENCY, DEFAULT_RATES, MARKET_CURRENCY, foreignCurrencyIn, mergeMissing, missingRateText, nextRates, rateTable, rowCurrency, sumUsd, toUsd } from "@/core/currency";
import { catalogueConflicts, marketLabel, marketName, orderConflicts, productHref, productMarkets, withMarket } from "@/core/markets";
import { MARKETS, MARKET_AR } from "@/core/naming";
import { computeSet, emptyRaw, sumRaw, totalSet, type Ctx, type Raw } from "@/core/numbers";
import { parsePaste } from "@/core/paste-parse";
import { decodeGap, encodeGap, gapText, truthMoney } from "@/core/truth-money";
import { compareWeeks, weeklyText } from "@/core/weekly";
import { headerCurrency } from "@/io/import";
import { economicsFromOms } from "@/jobs/truth";
import { DEFAULT_RULES } from "@/core/rules-v2";
import { buildAlerts } from "@/core/today";
import { statMissing, wasNow } from "@/core/compare";
import { numbersReadiness, type SourceFacts } from "@/core/numbers-readiness";

const usd = (amount: string, currency: string | null, owner: unknown = {}) => toUsd(amount, currency, rateTable(owner)).usd?.toDecimalPlaces(2).toNumber() ?? null;

describe("the rates in force", () => {
  it("only pegged currencies have a default; every floating market currency is missing until the owner writes it", () => {
    expect(DEFAULT_RATES).toEqual({ JOD: 0.709, SAR: 3.75 });
    const t = rateTable({});
    expect(t.get("USD")).toEqual({ perUsd: 1, source: "base", at: null });
    expect(t.get("JOD")).toEqual({ perUsd: 0.709, source: "default", at: null });
    for (const c of ["SYP", "EGP", "LYD", "MRU"]) expect(t.has(c)).toBe(false);
    expect(Object.keys(MARKET_CURRENCY).sort()).toEqual([...MARKETS].sort());
  });
  it("the owner's row wins over the default and carries its date; a broken row is ignored, and the dollar cannot be rewritten", () => {
    const t = rateTable({ jod: { perUsd: 0.71, at: "2026-11-01T00:00:00Z" }, EGP: { perUsd: 0, at: "x" }, USD: { perUsd: 5, at: "x" }, nonsense: 4 });
    expect(t.get("JOD")).toMatchObject({ perUsd: 0.71, source: "owner", at: "2026-11-01T00:00:00Z" });
    expect(t.has("EGP")).toBe(false);
    expect(t.get("USD")!.perUsd).toBe(1);
  });
  it("a settings value that is not a table at all leaves the defaults", () => {
    for (const bad of [null, undefined, 0.01, "x", []]) expect([...rateTable(bad).keys()].sort()).toEqual(["JOD", "SAR", "USD"]);
  });
});

describe("one amount in dollars", () => {
  it("dinars are divided by the rate: 18.500 JOD is 26.09$, never 18.5$", () => expect(usd("18.500", "JOD")).toBe(26.09));
  it("dollars are themselves, whatever the case", () => expect(usd("20.00", "usd")).toBe(20));
  it("no rate is no number, and the currency is named", () => expect(toUsd("500", "EGP", rateTable({}))).toEqual({ usd: null, missing: "EGP" }));
  it("with the owner's rate it converts", () => expect(usd("500", "EGP", { EGP: { perUsd: 50, at: "x" } })).toBe(10));
  it("a zero is a zero in any currency", () => expect(usd("0", "EGP")).toBe(0));
  it("an amount with no currency at all is missing, not dollars", () => expect(toUsd("5", null, rateTable({})).missing).toBe("؟"));
});

describe("a sum", () => {
  it("adds converted amounts", () => expect(sumUsd([{ amount: "10", currency: "USD" }, { amount: "7.09", currency: "JOD" }], rateTable({})).usd!.toNumber()).toBe(20));
  it("one amount with no rate makes the whole sum unknown — never a partial one", () => {
    const s = sumUsd([{ amount: "10", currency: "USD" }, { amount: "100", currency: "SYP" }, { amount: "9", currency: "EGP" }, { amount: "1", currency: "SYP" }], rateTable({}));
    expect(s).toEqual({ usd: null, missing: ["EGP", "SYP"] });
    expect(missingRateText(s.missing)).toBe("ناقص سعر صرف: EGP، SYP");
  });
  it("merges lists once each", () => expect(mergeMissing(["SYP"], "EGP,SYP", null, undefined)).toEqual(["EGP", "SYP"]));
});

describe("the currency of a stored spend row", () => {
  it("what is written on the row", () => expect(rowCurrency({ currency: "JOD", source: "mcp" }, "USD")).toBe("JOD"));
  it("an older pushed or pasted row is dollars (the push's contract), even on another account", () => {
    expect(rowCurrency({ currency: null, source: "mcp" }, "JOD")).toBe(BASE_CURRENCY);
    expect(rowCurrency({ source: "manual" }, "JOD")).toBe("USD");
  });
  it("an older Meta or imported row is in its account's currency; with no account, nobody knows", () => {
    expect(rowCurrency({ source: "api" }, "JOD")).toBe("JOD");
    expect(rowCurrency({ source: "import" }, undefined)).toBeNull();
  });
});

describe("what the owner saves", () => {
  const now = new Date("2026-11-25T10:00:00Z");
  const was = { EGP: { perUsd: 50, at: "2026-11-01T00:00:00Z" } };
  it("a new rate takes today's date; an unchanged one keeps its own", () => {
    expect(nextRates(was, { EGP: 50, SYP: 120 }, now)).toEqual({ rates: { EGP: { perUsd: 50, at: "2026-11-01T00:00:00Z" }, SYP: { perUsd: 120, at: now.toISOString() } } });
  });
  it("a changed rate takes today's date; an empty box removes the owner's row", () => {
    expect(nextRates(was, { EGP: 51 }, now)).toEqual({ rates: { EGP: { perUsd: 51, at: now.toISOString() } } });
    expect(nextRates(was, { EGP: null }, now)).toEqual({ rates: {} });
  });
  it("a pegged default typed as it is stays a default", () => expect(nextRates({}, { JOD: 0.709 }, now)).toEqual({ rates: {} }));
  it("refuses a zero, a negative, a word and the dollar", () => {
    const bad: Record<string, number>[] = [{ EGP: 0 }, { EGP: -2 }, { EGPT: 4 }, { USD: 1 }];
    for (const b of bad) expect(nextRates({}, b, now)).toHaveProperty("error");
  });
});

describe("pasted and imported figures", () => {
  const ctx = { day: "2026-11-24", level: "ad" as const };
  it("a dollar table reads as before", () => {
    const r = parsePaste("Ad ID\tAmount spent (USD)\n123\t12.5", ctx);
    expect(r.rows[0]!.row.spend).toBe(12.5);
  });
  it("a money column in another currency is refused whole, in words", () => {
    const r = parsePaste("Ad ID\tAmount spent (JOD)\n123\t12.5", ctx);
    expect(r.rows).toEqual([]);
    expect(r.issues[0]!.error).toContain("JOD");
  });
  it("a cell that names another currency is refused, not read as dollars", () => {
    const r = parsePaste("Ad ID\tspend\n123\t12 دينار\n124\t3$", ctx);
    expect(r.rows.map((x) => x.row.id)).toEqual(["124"]);
    expect(r.issues[0]!.line).toBe(2);
  });
  it("finds a currency in a header", () => {
    expect(foreignCurrencyIn("المبلغ المنفق (SYP)")).toBe("SYP");
    expect(foreignCurrencyIn("Cost €")).toBe("EUR");
    expect(foreignCurrencyIn("Amount spent (USD)")).toBeNull();
  });
  it("an Ads Manager export says its currency beside the spend column", () => {
    expect(headerCurrency(["Day", "Amount spent (JOD)"], { spend: 1 })).toBe("JOD");
    expect(headerCurrency(["Day", "Amount spent"], { spend: 1 })).toBeNull();
  });
});

describe("the OMS catalogue's money", () => {
  const p = { code: "TRF01", name: "كمأة", currency: "JOD", price_options: [{ price: "14.18" }], unit_cost_usd: "3.25", delivery_fee: "2.127", return_fee: "1.00", cod_fee_pct: null };
  it("prices and fees in dinars become dollars; the dollar cost stays as it is", () => {
    const r = economicsFromOms(p);
    expect(r.update).toMatchObject({ price: "20", deliveryFee: "3", returnFee: "1.41", unitCost: "3.25" });
    expect(r.missing).toEqual([]);
  });
  it("with no rate the prices and fees are NOT written (what the owner typed stays), and the currency is named", () => {
    const r = economicsFromOms({ ...p, currency: "EGP" });
    expect(r.update).toEqual({ name: "كمأة", unitCost: "3.25" });
    expect(r.missing).toEqual(["EGP"]);
  });
  it("a dollar catalogue is untouched", () => expect(economicsFromOms({ ...p, currency: "USD" }).update.price).toBe("14.18"));
});

describe("numbers that stand on money with no rate", () => {
  const ctx: Ctx = { fx: 0.01, deliveryRate: 0.5, econ: { unitCost: 1, deliveryFee: 1, returnFee: 0 }, piecesPerDay: 1 };
  const raw = (over: Partial<Raw> = {}): Raw => ({ ...emptyRaw(), metaSpend: 100, ordersIn: 10, impressions: 1000, shippedOrders: 2, shippedPieces: 2, revenueShipped: 40, ...over });
  it("the spend and everything on it is unknown; the counts stay", () => {
    const s = computeSet(raw({ fxMissing: ["EGP"] }), ctx);
    expect([s.spend, s.costPerOrder, s.cpm, s.expectedProfit]).toEqual([null, null, null, null]);
    expect(s.ordersIn).toBe(10);
  });
  it("a total that holds one such part has no spend and no profit — not the sum of the others", () => {
    const parts = [raw(), raw({ metaSpend: null, fxMissing: ["SYP"] })].map((r) => ({ raw: r, set: computeSet(r, ctx), piecesPerDay: 1 }));
    expect(sumRaw(parts.map((p) => p.raw)).metaSpend).toBeNull();
    const t = totalSet(parts, 0.01);
    expect([t.spend, t.expectedProfit]).toEqual([null, null]);
    expect(t.ordersIn).toBe(20);
  });
  it("a market with no economics that spent leaves the total's profit unknown", () => {
    const parts = [raw(), raw({ noEconomics: true })].map((r, i) => ({ raw: r, set: computeSet(r, i ? { ...ctx, econ: null } : ctx), piecesPerDay: 1 }));
    const t = totalSet(parts, 0.01);
    expect(t.spend).toBe(202);
    expect(t.expectedProfit).toBeNull();
  });
  const facts: SourceFacts = { now: "2026-11-25T10:00:00Z", metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-25T09:00:00Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true, fxMissing: ["EGP"] };
  it("the tile and the readiness card say «ناقص سعر صرف»", () => {
    const s = computeSet(raw({ fxMissing: ["EGP"] }), ctx);
    expect(wasNow("spend", s, s, [], facts, { days: 7, toDay: "2026-11-24" }).missing).toBe("ناقص سعر صرف: EGP");
    expect(statMissing("money", s, facts)).toBe("ناقص سعر صرف: EGP");
    expect(numbersReadiness(facts).find((i) => i.key === "fx")?.action?.href).toBe("/settings/rules#currency");
    expect(numbersReadiness({ ...facts, fxMissing: [] }).some((i) => i.key === "fx")).toBe(false);
  });
});

describe("a truth row whose money is unknown", () => {
  const row = { spendWithFee: "0", netCollected: "0", lossLimit: null, scalingCeiling: "4", costPerConfirmed: null, profitAfterCosts: "0", profitPerDelivered: null, trueRoas: null };
  it("encodes and reads the reason", () => {
    expect(encodeGap(["SYP", "EGP", "SYP"], true)).toBe("fx:EGP,SYP;market");
    expect(decodeGap("fx:EGP", "fx:SYP;market")).toEqual({ fx: ["EGP", "SYP"], market: true });
    expect(encodeGap([])).toBeNull();
    expect(gapText("fx:EGP", null)).toBe("ناقص سعر صرف: EGP");
  });
  it("a placeholder 0 is never read as a number", () => {
    expect(truthMoney({ ...row, spendMissing: "fx:EGP" })).toMatchObject({ spend: null, profit: null, netCollected: 0, ceiling: 4 });
    expect(truthMoney({ ...row, spendWithFee: "10", moneyMissing: "market" })).toMatchObject({ spend: 10, netCollected: null, ceiling: null, profit: null, roas: null });
    expect(truthMoney({ ...row, spendWithFee: "10" })).toMatchObject({ spend: 10, profit: 0, gap: null });
  });
  it("the weekly report writes «—» and says why, instead of a total with a hole", () => {
    const base = { code: "TRF01", name: "كمأة", orders: 10, matureOrders: 10, confirmed: 6, shipments: 5, delivered: 4 };
    const [p] = compareWeeks([{ ...base, spend: 12, profit: 3, spendGap: true, profitGap: true, gap: "ناقص سعر صرف: EGP" }], [{ ...base, spend: 40, profit: 8 }]);
    expect([p!.costPerConfirmed, p!.profitPerDelivered]).toEqual([null, null]);
    const text = weeklyText({ title: "t", products: [p!], rankings: {}, reconciliation: { pixelPurchases: 0, omsWebOrders: 0, delivered: 0 }, changes: { auto: 0, approved: 0, rejected: 0, rolledBack: 0, pending: 0 }, tests: [], lessons: [], winners: [], fatigued: [], plan: [] });
    expect(text).toContain("صرف —");
    expect(text).toContain("ناقص سعر صرف: EGP");
  });
});

describe("the home's alerts of a product judged market by market", () => {
  it("two lines of one code have two keys", () => {
    const alerts = buildAlerts({
      testShare: null, testLimit: 0.2, zeroOrders: [], stock: [], rules: { ...DEFAULT_RULES, breakeven: { TRF01: 1 } },
      products: [{ code: "TRF01", line: "TRF01", cost: 3, orders: 2 }, { code: "TRF01", line: "TRF01@JO", cost: 4, orders: 2 }],
    });
    expect(alerts.map((a) => a.key)).toEqual(["be:TRF01", "be:TRF01@JO"]);
  });
});

describe("every market has its Arabic name", () => {
  it("all six, and a country the site does not know is written as it came", () => {
    expect(MARKETS.map(marketLabel)).toEqual(MARKETS.map((m) => MARKET_AR[m]));
    expect(marketLabel("EG")).toBe("مصر");
    expect(marketLabel("MR")).toBe("موريتانيا");
    expect(marketLabel("IQ")).toBe("IQ");
    expect(marketLabel(null)).toBe("سوق مش معروف");
  });
});

describe("a product seen in one market or in two", () => {
  const configured = new Map([["TRF01", "SY"], ["TIN01", "SY"], ["NEW01", "LY"]]);
  const m = productMarkets(
    [{ code: "TRF01", market: "SY" }, { code: "TRF01", market: "JO" }, { code: "TRF01", market: null }, { code: "TIN01", market: "EG" }, { code: null, market: "SY" }],
    configured,
  );
  it("one market: the plain code, and its market is the one it is seen in", () => {
    expect(m.isSplit("TIN01")).toBe(false);
    expect(m.keyOf("TIN01", "EG")).toBe("TIN01");
    expect(m.keyOf("TIN01", null)).toBe("TIN01");
    expect(m.homeOf("TIN01")).toBe("EG");
    expect(m.isHome("TIN01", null)).toBe(true);
    expect(m.homeOf("NEW01")).toBe("LY");
  });
  it("two markets: a line each — the home keeps the code, the other says its market, the unplaced is its own", () => {
    expect(m.isSplit("TRF01")).toBe(true);
    expect([m.keyOf("TRF01", "SY"), m.keyOf("TRF01", "JO"), m.keyOf("TRF01", null)]).toEqual(["TRF01", "TRF01@JO", "TRF01@??"]);
    expect([m.marketOfKey("TRF01"), m.marketOfKey("TRF01@JO"), m.marketOfKey("TRF01@??")]).toEqual(["SY", "JO", null]);
    expect([m.isHome("TRF01", "SY"), m.isHome("TRF01", "JO"), m.isHome("TRF01", null)]).toEqual([true, false, false]);
    expect(marketName("كمأة", "TRF01@JO", m)).toBe("كمأة — الأردن");
    expect(marketName("طنين", "TIN01", m)).toBe("طنين");
  });
  it("a home that was never seen is nobody's: neither market takes the product's prices", () => {
    const x = productMarkets([{ code: "A", market: "JO" }, { code: "A", market: "EG" }], new Map([["A", "SY"]]));
    expect(x.homeOf("A")).toBeNull();
    expect([x.keyOf("A", "JO"), x.keyOf("A", "EG")]).toEqual(["A@JO", "A@EG"]);
    expect(x.isHome("A", "JO")).toBe(false);
  });
  it("the market stays on the addresses", () => {
    expect(withMarket("p=30&market=SY", "JO")).toBe("p=30&market=JO");
    expect(withMarket("p=30&market=SY", null)).toBe("p=30");
    expect(productHref({ code: "TRF01", split: true, market: "JO" }, "p=30")).toBe("/numbers/products/TRF01?p=30&market=JO");
    expect(productHref({ code: "TIN01", split: false, market: "EG" }, "")).toBe("/numbers/products/TIN01");
  });
});

describe("one code saying two things", () => {
  it("listed twice with different figures: refused; listed twice the same: not", () => {
    const a = { code: "TRF01", name: "كمأة", currency: "USD", price: "20.00" };
    expect(catalogueConflicts([a, { ...a, currency: "JOD", price: "14.00" }])).toMatchObject([{ code: "TRF01", kind: "catalogue" }]);
    expect(catalogueConflicts([a, a, { ...a, code: "TIN01" }])).toEqual([]);
  });
  it("two countries, or two currencies in one country, are said", () => {
    const c = orderConflicts([
      { code: "TRF01", market: "SY", currency: "USD" }, { code: "TRF01", market: "JO", currency: "JOD" },
      { code: "TIN01", market: "JO", currency: "JOD" }, { code: "TIN01", market: "JO", currency: "USD" },
      { code: "OK001", market: "SY", currency: "USD" }, { code: "OK001", market: "SY", currency: "USD" },
    ]);
    expect(c.map((x) => `${x.code}:${x.kind}`)).toEqual(["TIN01:currencies", "TRF01:markets"]);
    expect(c[1]!.text).toContain("الأردن");
  });
});
