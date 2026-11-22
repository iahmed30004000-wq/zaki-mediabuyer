/**
 * The site's own recipes, the pure half (v6 · P4-2, docs/rebuild-v6/01-model.md §9): the parameters of the four recipes, the three fixed steps each one has, and what each comes to for the data it is
 * given. The rule they all hold: a number that is missing makes THE STEP FAIL with its reason in words — it is never a zero — and a notice is once a day (its key says so).
 */
import { describe, expect, it } from "vitest";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import {
  ALL_PRODUCTS,
  PERIODS,
  RECIPES,
  RECIPE_STEP_IDS,
  STOCK_FRESH_H,
  WATCH_METRICS,
  checkRecipeTargets,
  dailySummaryReport,
  evalDailySummary,
  evalMetricWatch,
  evalRemind,
  evalStockAlert,
  isRecipeName,
  normalizeRecipe,
  parseRecipeParams,
  recipeSteps,
  suggestRecipeName,
  tellNote,
  validateRecipe,
  withTold,
  type StockCtx,
} from "@/core/recipes";
import { stockAlertKey } from "@/core/stock-alerts";

const NOW = new Date("2026-11-22T07:00:00.000Z"); // 10:00 on the Amman clock
const LIMITS = { redDays: 7, orangeDays: 10, yellowDays: 14 };
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...(Object.fromEntries(SET_KEYS.map((k) => [k, null])) as NumbersSet), ...over });

describe("the four recipes and their parameters", () => {
  it("are the four of the plan, and only those", () => {
    expect([...RECIPES]).toEqual(["stock_alert", "daily_summary", "remind", "metric_watch"]);
    expect(isRecipeName("remind")).toBe(true);
    expect(isRecipeName("free_steps")).toBe(false);
    expect(isRecipeName(undefined)).toBe(false);
  });

  it("stock_alert and daily_summary start sound: every parameter has its default", () => {
    expect(parseRecipeParams("stock_alert", {})).toEqual({ ok: true, params: { product: ALL_PRODUCTS } });
    expect(parseRecipeParams("daily_summary", undefined)).toEqual({ ok: true, params: { period: "yesterday" } });
  });

  it("a key the recipe does not know is dropped (the stored parameters are its own, nothing else rides along)", () => {
    expect(parseRecipeParams("stock_alert", { product: "TIN01", sneaky: "x" })).toEqual({ ok: true, params: { product: "TIN01" } });
    expect(normalizeRecipe({ name: "stock_alert", params: { days: 7 } })).toEqual({ name: "stock_alert", params: { product: "all" } });
  });

  it("remind needs a person and a text; the text is trimmed and at most 200 characters", () => {
    expect(parseRecipeParams("remind", {})).toMatchObject({ ok: false, field: "recipe.person", message: "اختار مين نذكّر" });
    expect(parseRecipeParams("remind", { person: "member1" })).toMatchObject({ ok: false, field: "recipe.text", message: "اكتب نص التذكير" });
    expect(parseRecipeParams("remind", { person: "member1", text: "   " })).toMatchObject({ ok: false, field: "recipe.text" });
    expect(parseRecipeParams("remind", { person: "member1", text: "x".repeat(201) })).toMatchObject({ ok: false, field: "recipe.text" });
    expect(parseRecipeParams("remind", { person: "Not A Key", text: "a" })).toMatchObject({ ok: false, field: "recipe.person" });
    expect(parseRecipeParams("remind", { person: "member1", text: "  راجع الشحنات  " })).toEqual({ ok: true, params: { person: "member1", text: "راجع الشحنات" } });
  });

  it("metric_watch needs the number, the direction and the limit; the product and the period have defaults", () => {
    expect(parseRecipeParams("metric_watch", { metric: "realCost", op: "above", limit: 4.5 })).toEqual({ ok: true, params: { metric: "realCost", op: "above", limit: 4.5, product: "all", period: "yesterday" } });
    expect(parseRecipeParams("metric_watch", {})).toMatchObject({ ok: false, field: "recipe.metric" });
    expect(parseRecipeParams("metric_watch", { metric: "spend", op: "above" })).toMatchObject({ ok: false, field: "recipe.limit", message: "اكتب الحد" });
    expect(parseRecipeParams("metric_watch", { metric: "spend", op: "above", limit: "" })).toMatchObject({ ok: false, field: "recipe.limit" });
    expect(parseRecipeParams("metric_watch", { metric: "spend", op: "above", limit: -1 })).toMatchObject({ ok: false, field: "recipe.limit" });
    expect(parseRecipeParams("metric_watch", { metric: "profit", op: "above", limit: 1 })).toMatchObject({ ok: false, field: "recipe.metric" });
    expect(parseRecipeParams("metric_watch", { metric: "spend", op: "sideways", limit: 1 })).toMatchObject({ ok: false, field: "recipe.op" });
    expect(parseRecipeParams("metric_watch", { metric: "spend", op: "below", limit: 1, period: "last year" })).toMatchObject({ ok: false, field: "recipe.period" });
  });

  it("the numbers it may watch are the six of 04-numbers.md §3 — and not a profit or a margin (those are money.view's)", () => {
    expect(WATCH_METRICS.map((m) => m.key)).toEqual(["realCost", "orders", "confirmRate", "spend", "costPerConfirmed", "deliveredRate"]);
    expect(WATCH_METRICS.map((m) => m.set).join(" ")).not.toMatch(/profit|margin|revenue/i);
    expect([...PERIODS]).toEqual(["today", "yesterday", "7d"]);
  });

  it("validateRecipe says the first thing wrong with the field it is about", () => {
    expect(validateRecipe({ name: "stock_alert", params: {} })).toEqual({ ok: true });
    expect(validateRecipe({ name: "nope", params: {} })).toMatchObject({ ok: false, field: "recipe" });
    expect(validateRecipe({ name: "metric_watch", params: { metric: "spend", op: "above" } })).toMatchObject({ ok: false, field: "recipe.limit" });
  });

  it("checkRecipeTargets: a product the site does not know, a person who is not there or not a person", () => {
    const known = { productCodes: ["TIN01"], directory: [{ key: "member1", kind: "person", active: true }, { key: "claude", kind: "agent", active: true }, { key: "gone", kind: "person", active: false }] };
    expect(checkRecipeTargets({ name: "stock_alert", params: { product: "TIN01" } }, known)).toBeNull();
    expect(checkRecipeTargets({ name: "stock_alert", params: { product: "all" } }, known)).toBeNull();
    expect(checkRecipeTargets({ name: "stock_alert", params: { product: "ZZZ99" } }, known)).toMatchObject({ field: "recipe.product" });
    expect(checkRecipeTargets({ name: "remind", params: { person: "member1", text: "x" } }, known)).toBeNull();
    expect(checkRecipeTargets({ name: "remind", params: { person: "claude", text: "x" } }, known)).toMatchObject({ field: "recipe.person", message: "التذكير لشخص، مش لوكيل" });
    expect(checkRecipeTargets({ name: "remind", params: { person: "gone", text: "x" } }, known)).toMatchObject({ field: "recipe.person" });
    expect(checkRecipeTargets({ name: "remind", params: { person: "nobody", text: "x" } }, known)).toMatchObject({ field: "recipe.person" });
  });
});

describe("the three fixed steps", () => {
  it("every recipe is read · compare · tell, in the owner's words", () => {
    for (const r of RECIPES) {
      const params = r === "remind" ? { person: "member1", text: "راجع" } : r === "metric_watch" ? { metric: "realCost", op: "above", limit: 4 } : {};
      const steps = recipeSteps(r, params, { member1: "عضو الفريق" });
      expect(steps.map((s) => s.verb)).toEqual(["read", "compare", "tell"]);
      for (const s of steps) {
        expect(s.text).toMatch(/[؀-ۿ]/);
        // a node's label is «<verb>: <text>» and is at most 120 characters: the text is at most 100
        expect(s.text.length).toBeLessThanOrEqual(100);
      }
    }
    expect([...RECIPE_STEP_IDS]).toEqual(["s1", "s2", "s3"]);
  });

  it("the steps carry the thing the recipe is about, by name — and no number of the owner's own rules", () => {
    expect(recipeSteps("stock_alert", { product: "TIN01" }, { TIN01: "قطرة طنين الأذن" })[0]!.text).toBe("مخزون قطرة طنين الأذن");
    expect(recipeSteps("stock_alert", {}, {})[0]!.text).toBe("مخزون كل المنتجات");
    expect(recipeSteps("remind", { person: "member1", text: "راجع" }, { member1: "عضو الفريق" })[2]!.text).toBe("ذكّر عضو الفريق");
    const watch = recipeSteps("metric_watch", { metric: "realCost", op: "above", limit: 4.5, product: "TIN01", period: "7d" }, { TIN01: "الطنين" });
    expect(watch[0]!.text).toBe("تكلفة الطلب الحقيقي لـالطنين (آخر 7 أيام)");
    expect(watch[1]!.text).toBe("مع الحد: فوق 4.5$");
    expect(recipeSteps("stock_alert", {}, {}).map((s) => s.text).join(" ")).not.toMatch(/\d/);
  });

  it("the name suggested for the job says the recipe and what it is about", () => {
    expect(suggestRecipeName("stock_alert", {})).toBe("نبّهني لما منتج يقرب يخلص");
    expect(suggestRecipeName("stock_alert", { product: "TIN01" }, { TIN01: "الطنين" })).toBe("نبّهني لما منتج يقرب يخلص: الطنين");
    expect(suggestRecipeName("metric_watch", { metric: "spend", op: "above", limit: 100 })).toBe("نبّهني لما رقم يعدّي حد: الصرف");
    expect(suggestRecipeName("remind", { person: "member1", text: "x" }, { member1: "عضو الفريق" })).toBe("ذكّر شخص: عضو الفريق");
    // parameters that are not sound yet: the recipe's own title, never an error
    expect(suggestRecipeName("remind", {})).toBe("ذكّر شخص");
  });
});

describe("stock_alert", () => {
  const ctx = (over: Partial<StockCtx> = {}): StockCtx => ({
    now: NOW,
    products: [{ code: "TIN01", name: "الطنين" }, { code: "TRF01", name: "الكمأة" }, { code: "NEW01", name: "جديد" }],
    readings: [
      { code: "TIN01", units: 40, daysCover: 4.2, at: hoursAgo(3) },
      { code: "TRF01", units: 900, daysCover: 30, at: hoursAgo(5) },
    ],
    limits: LIMITS,
    audience: ["owner", "member1"],
    ...over,
  });

  it("a product under the limits: one notice per person told, with the key a push of the stock writes (once a day per colour)", () => {
    const o = evalStockAlert({ product: ALL_PRODUCTS }, ctx());
    expect(o.ok).toBe(true);
    expect(o.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(o.notices).toHaveLength(2);
    expect(o.notices.map((n) => n.audience)).toEqual(["owner", "member1"]);
    expect(o.notices[0]).toMatchObject({ urgency: "red", key: stockAlertKey("TIN01", "red", "2026-11-22"), href: "/ads?product=TIN01" });
    expect(o.notices[0]!.title).toContain("الطنين");
    expect(o.metrics).toEqual({ products: 2, stock_red: 1, stock_orange: 0 });
    expect(o.steps[1]!.note).toContain("1 تحت الحد");
  });

  it("a product with no reading is NOT a zero: it is named in the first step, and the others still count", () => {
    const o = evalStockAlert({ product: ALL_PRODUCTS }, ctx());
    expect(o.steps[0]!.note).toContain("1 بلا قراءة حديثة: جديد");
    expect(o.notices.some((n) => n.title.includes("جديد"))).toBe(false);
  });

  it("everything above the limits: no notice, and the last step says there was nothing to tell", () => {
    const o = evalStockAlert({ product: ALL_PRODUCTS }, ctx({ readings: [{ code: "TIN01", units: 400, daysCover: 40, at: hoursAgo(1) }] }));
    expect(o.ok).toBe(true);
    expect(o.notices).toEqual([]);
    expect(o.steps[1]!.note).toBe("كل المنتجات فوق الحدود");
    expect(withTold(o, 0).steps[2]!.note).toBe("ما في شي يستاهل التبليغ");
  });

  it("a named product with no reading fails the FIRST step with the reason; nothing after it ran", () => {
    const o = evalStockAlert({ product: "NEW01" }, ctx());
    expect(o.ok).toBe(false);
    expect(o.steps).toEqual([{ id: "s1", status: "failed", error: "ما في مخزون مسجّل لـ جديد" }]);
    expect(o.reason).toBe("ما في مخزون مسجّل لـ جديد");
    expect(o.notices).toEqual([]);
  });

  it("a reading older than 72 hours is not the stock any more: the step says so", () => {
    expect(STOCK_FRESH_H).toBe(72);
    const o = evalStockAlert({ product: "TIN01" }, ctx({ readings: [{ code: "TIN01", units: 1, daysCover: 1, at: hoursAgo(24 * 5) }] }));
    expect(o.ok).toBe(false);
    expect(o.steps[0]!.error).toContain("قديم (قبل 5 يوم)");
  });

  it("no reading of any product: it fails, it does not say «all fine»", () => {
    const o = evalStockAlert({ product: ALL_PRODUCTS }, ctx({ readings: [] }));
    expect(o.ok).toBe(false);
    expect(o.steps[0]).toMatchObject({ id: "s1", status: "failed" });
    expect(o.steps[0]!.error).toContain("ما في مخزون مسجّل لأي منتج");
  });

  it("a product the site never heard of is told so", () => {
    expect(evalStockAlert({ product: "ZZZ99" }, ctx()).steps[0]!.error).toContain("مش معروف");
  });

  it("zero days of cover is a reading — the reddest one — not a missing number", () => {
    const o = evalStockAlert({ product: "TIN01" }, ctx({ readings: [{ code: "TIN01", units: 0, daysCover: 0, at: hoursAgo(1) }] }));
    expect(o.ok).toBe(true);
    expect(o.notices[0]).toMatchObject({ urgency: "red" });
  });

  it("the colours follow the owner's limits, not numbers of the code", () => {
    const o = evalStockAlert({ product: "TIN01" }, ctx({ limits: { redDays: 3, orangeDays: 5, yellowDays: 6 }, audience: ["owner"] }));
    expect(o.notices).toHaveLength(1);
    expect(o.notices[0]).toMatchObject({ urgency: "orange" });
  });
});

describe("metric_watch", () => {
  const p = { metric: "realCost", product: ALL_PRODUCTS, op: "above" as const, limit: 4, period: "yesterday" as const };

  it("a number over its limit: one notice, once a day (the key has the job and the day on the Amman clock)", () => {
    const o = evalMetricWatch(p, { jobKey: "wf-1", now: NOW, value: 4.6, productName: "كل المنتجات" });
    expect(o.ok).toBe(true);
    expect(o.notices).toEqual([{ urgency: "orange", audience: "owner", title: "تكلفة الطلب الحقيقي فوق الحد", body: "كل المنتجات (أمس): 4.60$ مقابل حد 4.00$.", href: "/ads", key: "metric:wf-1:2026-11-22" }]);
    expect(o.steps[1]!.note).toBe("4.60$ مقابل الحد 4.00$ — تعدّى الحد");
    expect(o.metrics).toEqual({ value: 4.6, limit: 4 });
  });

  it("within the limit: no notice, and the step says it is still within", () => {
    const o = evalMetricWatch(p, { jobKey: "wf-1", now: NOW, value: 3.9, productName: "كل المنتجات" });
    expect(o.notices).toEqual([]);
    expect(o.steps[1]!.note).toContain("لسا ضمن الحد");
  });

  it("«below»: a rate that falls under its limit", () => {
    const o = evalMetricWatch({ ...p, metric: "confirmRate", op: "below", limit: 60 }, { jobKey: "wf-1", now: NOW, value: 52.5, productName: "الطنين" });
    expect(o.notices).toHaveLength(1);
    expect(o.notices[0]!.title).toBe("نسبة التأكيد تحت الحد");
    expect(o.notices[0]!.body).toContain("52.5%");
  });

  it("exactly on the limit is not over it", () => {
    expect(evalMetricWatch(p, { jobKey: "wf-1", now: NOW, value: 4, productName: "x" }).notices).toEqual([]);
    expect(evalMetricWatch({ ...p, op: "below" }, { jobKey: "wf-1", now: NOW, value: 4, productName: "x" }).notices).toEqual([]);
  });

  it("a number that is not known fails the FIRST step with why — it is never read as zero (which would be «under the limit» for a «below» watch)", () => {
    for (const op of ["above", "below"] as const) {
      const o = evalMetricWatch({ ...p, op }, { jobKey: "wf-1", now: NOW, value: null, productName: "الطنين" });
      expect(o.ok).toBe(false);
      expect(o.notices).toEqual([]);
      expect(o.steps).toHaveLength(1);
      expect(o.steps[0]).toMatchObject({ id: "s1", status: "failed" });
      expect(o.steps[0]!.error).toBe("تكلفة الطلب الحقيقي لـالطنين (أمس) ناقص — الصرف أو الطلبات ناقصة (ميتا مش مربوطة، أو الطلبات ما انسحبت)");
    }
    for (const m of WATCH_METRICS) expect(evalMetricWatch({ ...p, metric: m.key }, { jobKey: "k", now: NOW, value: null, productName: "x" }).steps[0]!.error).toContain(m.missing);
  });

  it("a real zero is a number: no orders is «0 orders», and a «below 3» watch tells", () => {
    const o = evalMetricWatch({ ...p, metric: "orders", op: "below", limit: 3 }, { jobKey: "k", now: NOW, value: 0, productName: "x" });
    expect(o.ok).toBe(true);
    expect(o.notices).toHaveLength(1);
  });
});

describe("daily_summary", () => {
  const today = set({ spend: 120, ordersIn: 40, costPerOrder: 3, confirmed: 30, confirmRate: 75, shippedOrders: 20, delivered: 10, expectedProfit: 555.55 });
  const before = set({ spend: 100, ordersIn: 32, costPerOrder: 3.12 });
  const base = { jobKey: "wf-2", now: NOW, label: "أمس", totals: today, prev: before, products: [{ name: "الطنين", set: today }, { name: "فاضي", set: set() }], runHref: "/tasks/wf-2/runs/r1" };

  it("a day with numbers: a notice (silent, in the site), a report, the numbers, and the comparison with the period before", () => {
    const o = evalDailySummary({ period: "yesterday" }, base);
    expect(o.ok).toBe(true);
    expect(o.steps.map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
    expect(o.steps[0]!.note).toBe("قريت أرقام أمس: 1 منتج");
    expect(o.steps[1]!.note).toBe("الطلبات 40 (قبلها 32) · تكلفة الطلب 3.00$ (قبلها 3.12$)");
    expect(o.notices).toEqual([{ urgency: "yellow", audience: "owner", title: "ملخص أمس", body: "صرف 120.00$ · طلبات 40 · تكلفة الطلب 3.00$", href: "/tasks/wf-2/runs/r1", key: "summary:wf-2:2026-11-22" }]);
    expect(o.metrics).toEqual({ products: 1, spend: 120, orders: 40, confirmed: 30, delivered: 10 });
    expect(o.report).toContain("المجموع: صرف 120.00$");
    expect(o.report).toContain("الطنين: صرف 120.00$");
    expect(o.report).not.toContain("فاضي");
  });

  it("the report has no profit and no margin: it is read by roles that may not hold money.view", () => {
    const o = evalDailySummary({ period: "yesterday" }, base);
    expect(o.report).not.toMatch(/ربح|هامش|555/);
    expect(Object.keys(o.metrics).join(" ")).not.toMatch(/profit|margin/i);
    expect(dailySummaryReport("أمس", today, base.products)).not.toContain("555");
  });

  it("a number that is missing is «—», never a zero", () => {
    const o = evalDailySummary({ period: "yesterday" }, { ...base, totals: set({ ordersIn: 5 }), prev: set(), products: [] });
    expect(o.ok).toBe(true);
    expect(o.report).toContain("صرف —");
    expect(o.report).not.toContain("صرف 0");
    expect(o.steps[1]!.note).toBe("ما في فترة قبلها للمقارنة");
    expect(o.metrics).toEqual({ products: 0, orders: 5 });
  });

  it("nothing at all for the day fails the first step with the reason (it does not send «a summary of nothing»)", () => {
    const o = evalDailySummary({ period: "yesterday" }, { ...base, totals: set(), products: [] });
    expect(o.ok).toBe(false);
    expect(o.steps).toEqual([{ id: "s1", status: "failed", error: "ما في أرقام لـأمس — ميتا مش مربوطة، والطلبات ما انسحبت ولا Claude بعتها" }]);
    expect(o.notices).toEqual([]);
    expect(o.report).toBeUndefined();
  });

  it("the report fits what a run may hold (6000 characters)", () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ name: `منتج رقم ${i}`, set: today }));
    expect(dailySummaryReport("أمس", today, many).length).toBeLessThanOrEqual(6000);
  });
});

describe("remind", () => {
  const person = { key: "member1", name: "عضو الفريق", active: true, kind: "person" as const, hasTelegram: true };

  it("a person from the directory: the notice is theirs, once per run, and the second step says how it reaches them", () => {
    const o = evalRemind({ person: "member1", text: "راجع الشحنات العالقة" }, { jobKey: "wf-3", ref: "slot-2026-11-22T07:00:00.000Z", person });
    expect(o.ok).toBe(true);
    expect(o.notices).toEqual([{ urgency: "orange", audience: "member1", title: "تذكير: راجع الشحنات العالقة", body: "راجع الشحنات العالقة", href: "/tasks/team", key: "remind:wf-3:slot-2026-11-22T07:00:00.000Z" }]);
    expect(o.steps[1]!.note).toBe("تيليجرام مربوط — بيوصله عليه وبالموقع");
    expect(evalRemind({ person: "member1", text: "x" }, { jobKey: "k", ref: "r", person: { ...person, hasTelegram: false } }).steps[1]!.note).toBe("ما في رقم تيليجرام إله — بيوصله بالموقع بس");
  });

  it("a person who is not in the directory, or is switched off, fails the first step", () => {
    expect(evalRemind({ person: "ghost", text: "x" }, { jobKey: "k", ref: "r", person: null }).steps).toEqual([{ id: "s1", status: "failed", error: "«ghost» مش بدليل الفريق" }]);
    const off = evalRemind({ person: "member1", text: "x" }, { jobKey: "k", ref: "r", person: { ...person, active: false } });
    expect(off.ok).toBe(false);
    expect(off.steps[0]!.error).toBe("عضو الفريق مش مفعّل بدليل الفريق");
    expect(off.notices).toEqual([]);
  });
});

describe("the sentence of the last step", () => {
  it("says how many were told, how many were already told today", () => {
    expect(tellNote(0, 0)).toBe("ما في شي يستاهل التبليغ");
    expect(tellNote(1, 1)).toBe("بلّغت إشعار واحد");
    expect(tellNote(3, 3)).toBe("بلّغت 3 إشعارات");
    expect(tellNote(1, 0)).toBe("انبعت اليوم من قبل — ما انبعت تاني");
    expect(tellNote(4, 0)).toBe("4 إشعارات انبعتوا اليوم من قبل — ما انبعتوا تاني");
    expect(tellNote(4, 1)).toBe("بلّغت 1 من 4 (الباقي انبعت اليوم من قبل)");
  });

  it("a failed outcome is left as it is", () => {
    const failed = evalMetricWatch({ metric: "spend", product: "all", op: "above", limit: 1, period: "today" }, { jobKey: "k", now: NOW, value: null, productName: "x" });
    expect(withTold(failed, 3)).toBe(failed);
  });
});
