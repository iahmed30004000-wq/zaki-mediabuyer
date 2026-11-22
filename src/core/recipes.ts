/**
 * THE SITE'S OWN RECIPES (v6 · P4-2, docs/rebuild-v6/01-model.md §9), the pure half. «الموقع لحاله» does not run free steps: it carries out four recipes written in code, on numbers
 * the code computes (nothing here asks a model anything, and no customer's data is ever read). Every recipe has the same three fixed steps — read, compare, tell — so the rope of lamps
 * works on it like on any other job, and a number that is missing makes THE STEP FAIL with its reason in words, never a zero that looks like a number.
 *
 *   stock_alert     نبّهني لما منتج يقرب يخلص          a notice for every product under the limits, once a day per colour (the same key a push of the stock uses)
 *   daily_summary   ابعتلي ملخص اليوم                  a notice and a report on the results page (no profit, no margin: those are for `money.view`)
 *   remind          ذكّر شخص                           a notice to one person from the team directory
 *   metric_watch    نبّهني لما رقم يعدّي حد             one number (from a short list), one product or all, one limit: a notice when it crosses, once a day
 *
 * The data comes in as plain values (the server half gathers it: src/server/recipes) and a recipe's outcome is data too: the steps that ran, the sentence, the numbers, the notices to write.
 * Nothing here reads a database, a clock (`now` is a parameter) or the network.
 */
import { z } from "zod";
import { ammanKey } from "./dates";
import { formatStat, type NumbersSet, type SetKey } from "./numbers";
import { stockAlertKey, stockAlertText, stockUrgency, type StockThresholds } from "./stock-alerts";

export const RECIPES = ["stock_alert", "daily_summary", "remind", "metric_watch"] as const;
export type RecipeName = (typeof RECIPES)[number];
export const isRecipeName = (v: unknown): v is RecipeName => typeof v === "string" && (RECIPES as readonly string[]).includes(v);

/** The words of a recipe on its tile (the first is the title, the second the line under it). */
export const RECIPE_TITLE: Record<RecipeName, string> = {
  stock_alert: "نبّهني لما منتج يقرب يخلص",
  daily_summary: "ابعتلي ملخص اليوم",
  remind: "ذكّر شخص",
  metric_watch: "نبّهني لما رقم يعدّي حد",
};
export const RECIPE_HINT: Record<RecipeName, string> = {
  stock_alert: "بحدود المخزون اللي كاتبها",
  daily_summary: "بالإشعار وبصفحة النتائج",
  remind: "بنص بتكتبه، لشخص من الفريق",
  metric_watch: "رقم، منتج، وحد",
};
/** The kind a recipe's job gets on the map (the owner may still change it). */
export const RECIPE_DOMAIN: Record<RecipeName, "ads" | "ops"> = { stock_alert: "ops", daily_summary: "ads", remind: "ops", metric_watch: "ads" };

export const ALL_PRODUCTS = "all";
const PRODUCT = z.string().trim().regex(/^[A-Za-z0-9_-]{1,40}$/, "كود المنتج حروف إنجليزية وأرقام");
const ACTOR_KEY = z.string().trim().regex(/^[a-z][a-z0-9_-]{1,31}$/, "اختار الشخص");

// ───────────────────────────── the numbers metric_watch may watch ─────────────────────────────

export interface WatchMetric {
  key: string;
  label: string;
  /** which of the numbers of the screen it reads */
  set: SetKey;
  unit: "$" | "%" | "";
  /** why it can be missing, in words (the step fails with it) */
  missing: string;
}

/** The short list of 04-numbers.md §3: the numbers that have a «was / now». */
export const WATCH_METRICS: readonly WatchMetric[] = [
  { key: "realCost", label: "تكلفة الطلب الحقيقي", set: "costPerOrder", unit: "$", missing: "الصرف أو الطلبات ناقصة (ميتا مش مربوطة، أو الطلبات ما انسحبت)" },
  { key: "orders", label: "الطلبات الحقيقية", set: "ordersIn", unit: "", missing: "الطلبات ما انسحبت من نظام الطلبات ولا Claude بعتها" },
  { key: "confirmRate", label: "نسبة التأكيد", set: "confirmRate", unit: "%", missing: "المؤكد والمرفوض ناقصين" },
  { key: "spend", label: "الصرف", set: "spend", unit: "$", missing: "ميتا مش مربوطة وClaude ما بعت أرقام الصرف" },
  { key: "costPerConfirmed", label: "تكلفة المؤكد", set: "costPerConfirmed", unit: "$", missing: "الصرف أو المؤكد ناقصين" },
  { key: "deliveredRate", label: "نسبة التسليم (30 يوم)", set: "deliveryRate30", unit: "%", missing: "ما في تسليم أو مرتجع مسجّل لآخر 30 يوم" },
];
export const WATCH_METRIC_KEYS = WATCH_METRICS.map((m) => m.key) as [string, ...string[]];
export const watchMetric = (key: string): WatchMetric | undefined => WATCH_METRICS.find((m) => m.key === key);

export const PERIODS = ["today", "yesterday", "7d"] as const;
export type Period = (typeof PERIODS)[number];
export const PERIOD_AR: Record<Period, string> = { today: "اليوم لهلق", yesterday: "أمس", "7d": "آخر 7 أيام" };
export const OPS = ["above", "below"] as const;
export const OP_AR = { above: "فوق", below: "تحت" } as const;

// ───────────────────────────── the parameters ─────────────────────────────

const StockParams = z.object({ product: PRODUCT.default(ALL_PRODUCTS) });
const SummaryParams = z.object({ period: z.enum(["today", "yesterday"]).default("yesterday") });
const RemindParams = z.object({ person: ACTOR_KEY, text: z.string().trim().min(1, "اكتب نص التذكير").max(200, "نص التذكير لحد 200 حرف") });
const MetricParams = z.object({
  metric: z.enum(WATCH_METRIC_KEYS),
  product: PRODUCT.default(ALL_PRODUCTS),
  op: z.enum(OPS),
  limit: z.number({ message: "اكتب الحد رقم" }).min(0, "الحد من صفر وطالع").max(1_000_000, "الحد كبير كتير"),
  period: z.enum(PERIODS).default("yesterday"),
});

export type StockParamsT = z.infer<typeof StockParams>;
export type SummaryParamsT = z.infer<typeof SummaryParams>;
export type RemindParamsT = z.infer<typeof RemindParams>;
export type MetricParamsT = z.infer<typeof MetricParams>;
export type RecipeParams = { stock_alert: StockParamsT; daily_summary: SummaryParamsT; remind: RemindParamsT; metric_watch: MetricParamsT };

const SCHEMAS = { stock_alert: StockParams, daily_summary: SummaryParams, remind: RemindParams, metric_watch: MetricParams } as const;

/** What a field of the form is called in a message, by recipe. */
const FIELD_OF: Record<string, string> = { product: "recipe.product", period: "recipe.period", person: "recipe.person", text: "recipe.text", metric: "recipe.metric", op: "recipe.op", limit: "recipe.limit" };

export type ParamsRead<N extends RecipeName> = { ok: true; params: RecipeParams[N] } | { ok: false; field: string; message: string };

/** The parameters of a recipe as it carries them out: unknown keys dropped, the defaults filled in, the texts trimmed. The first thing wrong comes back with the field it is about. */
export function parseRecipeParams<N extends RecipeName>(name: N, raw: unknown): ParamsRead<N> {
  const input: Record<string, unknown> = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const r = SCHEMAS[name].safeParse(input);
  if (r.success) return { ok: true, params: r.data as RecipeParams[N] };
  const issue = r.error.issues[0]!;
  const key = String(issue.path[0] ?? "");
  // a field that is not there says what to do about it; one that is there and wrong says what is wrong with it
  const message = input[key] === undefined ? (FIELD_MISSING[key] ?? "في حقل ناقص بالوصفة") : issue.message;
  return { ok: false, field: FIELD_OF[key] ?? "recipe", message };
}

const FIELD_MISSING: Record<string, string> = { person: "اختار مين نذكّر", text: "اكتب نص التذكير", metric: "اختار أي رقم نراقب", op: "اختار فوق الحد ولا تحته", limit: "اكتب الحد" };

/** `normalizeDraft`'s step for a recipe: the clean parameters when they read, the raw ones as they were when they do not (`validateRecipe` says what is wrong). */
export function normalizeRecipe(recipe: { name: RecipeName; params: Record<string, unknown> }): { name: RecipeName; params: Record<string, unknown> } {
  const r = parseRecipeParams(recipe.name, recipe.params);
  return r.ok ? { name: recipe.name, params: { ...r.params } } : recipe;
}

export type RecipeCheck = { ok: true } | { ok: false; field: string; message: string };

/** Is this recipe one the site may save? A name it knows and the parameters it needs. */
export function validateRecipe(recipe: { name: string; params: Record<string, unknown> }): RecipeCheck {
  if (!isRecipeName(recipe.name)) return { ok: false, field: "recipe", message: "وصفة مش معروفة" };
  const r = parseRecipeParams(recipe.name, recipe.params);
  return r.ok ? { ok: true } : { ok: false, field: r.field, message: r.message };
}

/**
 * What a recipe points at must exist: a product the site does not know would watch nothing, and a person who is not in the team directory (or who is an agent) could not be reminded.
 * `productCodes` and `directory` are what the site knows; the answer is null when the recipe is sound, otherwise the sentence and the field it is about.
 */
export function checkRecipeTargets(
  recipe: { name: string; params: Record<string, unknown> },
  known: { productCodes: readonly string[]; directory: readonly { key: string; kind: string; active: boolean }[] },
): { message: string; field: string } | null {
  const p = recipe.params;
  if (typeof p.product === "string" && p.product !== ALL_PRODUCTS && !known.productCodes.includes(p.product)) return { message: "هالمنتج مش بين منتجاتك", field: "recipe.product" };
  if (recipe.name === "remind") {
    const who = known.directory.find((e) => e.key === p.person);
    if (!who || !who.active) return { message: "هالشخص مش بدليل الفريق", field: "recipe.person" };
    if (who.kind !== "person") return { message: "التذكير لشخص، مش لوكيل", field: "recipe.person" };
  }
  return null;
}

// ───────────────────────────── the three steps ─────────────────────────────

/** The fixed steps of every recipe. The ids are the ones a drawing of three steps in a line gets (`s1` … `s3`). */
export const RECIPE_STEP_IDS = ["s1", "s2", "s3"] as const;
export interface RecipeStepSpec {
  verb: "read" | "compare" | "tell";
  text: string;
}

const productWords = (code: string, names: Readonly<Record<string, string>>) => (code === ALL_PRODUCTS ? "كل المنتجات" : (names[code] ?? code));

/** The three blocks of a recipe, in the owner's words (`names`: product codes and person keys to their names). */
export function recipeSteps(name: RecipeName, params: Record<string, unknown>, names: Readonly<Record<string, string>> = {}): RecipeStepSpec[] {
  const r = parseRecipeParams(name, params);
  switch (name) {
    case "stock_alert": {
      const p = (r.ok ? r.params : { product: ALL_PRODUCTS }) as StockParamsT;
      return [
        { verb: "read", text: `مخزون ${productWords(p.product, names)}` },
        { verb: "compare", text: "مع حدود المخزون اللي كاتبها" },
        { verb: "tell", text: "نبّه عن كل منتج تحت الحد، مرة باليوم لكل لون" },
      ];
    }
    case "daily_summary": {
      const p = (r.ok ? r.params : { period: "yesterday" }) as SummaryParamsT;
      return [
        { verb: "read", text: `أرقام ${p.period === "today" ? "اليوم لهلق" : "أمس"}` },
        { verb: "compare", text: "بالفترة اللي قبلها" },
        { verb: "tell", text: "ابعت الملخص وسجّله بالنتائج" },
      ];
    }
    case "remind": {
      const p = r.ok ? (r.params as RemindParamsT) : null;
      const who = p ? (names[p.person] ?? p.person) : "الشخص";
      return [
        { verb: "read", text: "الشخص من دليل الفريق" },
        { verb: "compare", text: "طريق وصوله (تيليجرام أو الموقع)" },
        { verb: "tell", text: `ذكّر ${who}` },
      ];
    }
    case "metric_watch": {
      const p = r.ok ? (r.params as MetricParamsT) : null;
      const m = p ? watchMetric(p.metric) : undefined;
      return [
        { verb: "read", text: p && m ? `${m.label} لـ${productWords(p.product, names)} (${PERIOD_AR[p.period]})` : "الرقم اللي بتراقبه" },
        { verb: "compare", text: p && m ? `مع الحد: ${OP_AR[p.op]} ${p.limit}${m.unit}` : "مع الحد" },
        { verb: "tell", text: "نبّهني لما يتعدّى، مرة باليوم" },
      ];
    }
  }
}

/** A name for the job, from the recipe: the title of the recipe, with the thing it is about («نبّهني لما رقم يعدّي حد — تكلفة الطلب الحقيقي»). */
export function suggestRecipeName(name: RecipeName, params: Record<string, unknown>, names: Readonly<Record<string, string>> = {}): string {
  const r = parseRecipeParams(name, params);
  if (!r.ok) return RECIPE_TITLE[name];
  if (name === "metric_watch") return `${RECIPE_TITLE[name]}: ${watchMetric((r.params as MetricParamsT).metric)?.label ?? ""}`.trim();
  if (name === "stock_alert" && (r.params as StockParamsT).product !== ALL_PRODUCTS) return `${RECIPE_TITLE[name]}: ${productWords((r.params as StockParamsT).product, names)}`;
  if (name === "remind") return `${RECIPE_TITLE[name]}: ${names[(r.params as RemindParamsT).person] ?? (r.params as RemindParamsT).person}`;
  return RECIPE_TITLE[name];
}

// ───────────────────────────── what a recipe came to ─────────────────────────────

export interface StepOutcome {
  id: (typeof RECIPE_STEP_IDS)[number];
  status: "done" | "failed";
  note?: string;
  /** only for a failed step: why, in words */
  error?: string;
}

export interface RecipeNotice {
  urgency: "red" | "orange" | "yellow";
  /** `owner` or the key of a person in the team directory */
  audience: string;
  title: string;
  body: string;
  href: string;
  /** the same notice twice is one: this is what makes a recipe «once a day» */
  key: string;
}

export interface RecipeOutcome {
  ok: boolean;
  /** the steps that ran, in order; the one that failed is the last (nothing after it ran) */
  steps: StepOutcome[];
  /** one line: what happened (a run's `summary`, at most 300) */
  summary: string;
  report?: string;
  metrics: Record<string, number | string>;
  notices: RecipeNotice[];
  /** why it stopped, for a failed run */
  reason?: string;
}

const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`);
const step = (id: StepOutcome["id"], note: string): StepOutcome => ({ id, status: "done", note: cut(note, 200) });

/** A recipe that stopped at a step: that step is the failed one and nothing after it ran. */
export function stoppedAt(at: StepOutcome["id"], reason: string, ran: StepOutcome[] = []): RecipeOutcome {
  const why = cut(reason, 280);
  return { ok: false, steps: [...ran, { id: at, status: "failed", error: why }], summary: why, metrics: {}, notices: [], reason: why };
}

/** The sentence of the step «بلّغ» once the notices were written: how many are new, how many were already told today. */
export function tellNote(total: number, created: number): string {
  if (!total) return "ما في شي يستاهل التبليغ";
  if (!created) return total === 1 ? "انبعت اليوم من قبل — ما انبعت تاني" : `${total} إشعارات انبعتوا اليوم من قبل — ما انبعتوا تاني`;
  if (created === total) return created === 1 ? "بلّغت إشعار واحد" : `بلّغت ${created} إشعارات`;
  return `بلّغت ${created} من ${total} (الباقي انبعت اليوم من قبل)`;
}

// ───────────────────────────── stock_alert ─────────────────────────────

/** A reading of the stock: the newest one of a product (what `StockSnapshot` holds). */
export interface StockReading {
  code: string;
  units: number | null;
  daysCover: number;
  at: Date;
}
export interface KnownProduct {
  code: string;
  name: string;
}

/** A reading older than this is not the stock any more: the step fails and says so (an alert from a week-old reading would be a lie). */
export const STOCK_FRESH_H = 72;

export interface StockCtx {
  now: Date;
  /** the products the site knows (their names) */
  products: readonly KnownProduct[];
  /** the newest reading of each product */
  readings: readonly StockReading[];
  limits: StockThresholds;
  /** who is told: the owner and the people the stock rules name */
  audience: readonly string[];
}

const ICON_WORD = { red: "أحمر", orange: "برتقالي", yellow: "أصفر" } as const;

export function evalStockAlert(p: StockParamsT, c: StockCtx): RecipeOutcome {
  const freshAt = c.now.getTime() - STOCK_FRESH_H * 3_600_000;
  const nameOf = (code: string) => c.products.find((x) => x.code === code)?.name ?? code;
  const readingOf = (code: string) => c.readings.find((r) => r.code === code);
  const wanted = p.product === ALL_PRODUCTS ? [...new Set([...c.products.map((x) => x.code), ...c.readings.map((r) => r.code)])].sort() : [p.product];

  if (p.product !== ALL_PRODUCTS && !c.products.some((x) => x.code === p.product) && !readingOf(p.product)) return stoppedAt("s1", `المنتج «${p.product}» مش معروف عندي`);
  const read = wanted.map((code) => ({ code, reading: readingOf(code) })).map((x) => ({ ...x, fresh: !!x.reading && x.reading.at.getTime() >= freshAt }));
  const usable = read.filter((x) => x.fresh);
  if (p.product !== ALL_PRODUCTS && !usable.length) {
    const old = read[0]?.reading;
    return stoppedAt("s1", old ? `آخر مخزون مسجّل لـ ${nameOf(p.product)} قديم (قبل ${Math.max(1, Math.round((c.now.getTime() - old.at.getTime()) / 86_400_000))} يوم) — Claude لازم يبعته من جديد` : `ما في مخزون مسجّل لـ ${nameOf(p.product)}`);
  }
  if (!usable.length) return stoppedAt("s1", "ما في مخزون مسجّل لأي منتج — Claude بيبعته آخر جولة الليل");

  const missing = read.filter((x) => !x.fresh).map((x) => nameOf(x.code));
  const s1 = step("s1", `قريت مخزون ${usable.length} منتج${missing.length ? ` · ${missing.length} بلا قراءة حديثة: ${missing.slice(0, 5).join("، ")}${missing.length > 5 ? "…" : ""}` : ""}`);

  const dayKey = c.now.toISOString().slice(0, 10);
  const under = usable
    .map((x) => ({ ...x, urgency: stockUrgency(x.reading!.daysCover, c.limits) }))
    .filter((x): x is typeof x & { urgency: "red" | "orange" | "yellow" } => x.urgency !== null);
  const count = (u: "red" | "orange" | "yellow") => under.filter((x) => x.urgency === u).length;
  const s2 = step("s2", under.length ? `${under.length} تحت الحد (أحمر ${count("red")} · برتقالي ${count("orange")} · أصفر ${count("yellow")})` : "كل المنتجات فوق الحدود");

  const notices: RecipeNotice[] = under.flatMap((x) => {
    const t = stockAlertText(nameOf(x.code), x.reading!.daysCover, x.urgency, x.reading!.units);
    return c.audience.map((audience) => ({ urgency: x.urgency, audience, title: t.title, body: t.body, href: `/ads?product=${encodeURIComponent(x.code)}`, key: stockAlertKey(x.code, x.urgency, dayKey) }));
  });
  const names = [...new Set(under.map((x) => nameOf(x.code)))];
  const summary = under.length ? `${usable.length} منتج انفحص: ${under.length} تحت الحد (${names.slice(0, 4).join("، ")}${names.length > 4 ? "…" : ""})` : `${usable.length} منتج انفحص: كلهم فوق الحد`;
  return { ok: true, steps: [s1, s2, step("s3", "")], summary: cut(summary, 300), metrics: { products: usable.length, stock_red: count("red"), stock_orange: count("orange") }, notices };
}

// ───────────────────────────── metric_watch ─────────────────────────────

export interface MetricCtx {
  jobKey: string;
  now: Date;
  /** the number the site computes for the product and the period (null: it is not known) */
  value: number | null;
  /** the product's name, or «كل المنتجات» */
  productName: string;
}

const printed = (unit: WatchMetric["unit"], v: number) => formatStat({ unit: unit === "" ? "" : unit }, v);

export function evalMetricWatch(p: MetricParamsT, c: MetricCtx): RecipeOutcome {
  const m = watchMetric(p.metric);
  if (!m) return stoppedAt("s1", "رقم مش معروف");
  if (c.value === null) return stoppedAt("s1", `${m.label} لـ${c.productName} (${PERIOD_AR[p.period]}) ناقص — ${m.missing}`);
  const s1 = step("s1", `${m.label} لـ${c.productName} (${PERIOD_AR[p.period]}): ${printed(m.unit, c.value)}`);
  const crossed = p.op === "above" ? c.value > p.limit : c.value < p.limit;
  const s2 = step("s2", `${printed(m.unit, c.value)} مقابل الحد ${printed(m.unit, p.limit)} — ${crossed ? "تعدّى الحد" : "لسا ضمن الحد"}`);
  const notices: RecipeNotice[] = crossed
    ? [
        {
          urgency: "orange",
          audience: "owner",
          title: cut(`${m.label} ${OP_AR[p.op]} الحد`, 45),
          body: cut(`${c.productName} (${PERIOD_AR[p.period]}): ${printed(m.unit, c.value)} مقابل حد ${printed(m.unit, p.limit)}.`, 200),
          href: "/ads",
          key: `metric:${c.jobKey}:${ammanKey(c.now)}`,
        },
      ]
    : [];
  const summary = crossed ? `${m.label} ${OP_AR[p.op]} الحد: ${printed(m.unit, c.value)} مقابل ${printed(m.unit, p.limit)}` : `${m.label} ضمن الحد: ${printed(m.unit, c.value)} مقابل ${printed(m.unit, p.limit)}`;
  return { ok: true, steps: [s1, s2, step("s3", "")], summary: cut(summary, 300), metrics: { value: c.value, limit: p.limit }, notices };
}

// ───────────────────────────── daily_summary ─────────────────────────────

export interface SummaryCtx {
  jobKey: string;
  now: Date;
  /** «أمس» · «اليوم لهلق»: the period as the numbers screen names it */
  label: string;
  totals: NumbersSet;
  /** the same numbers for the period before */
  prev: NumbersSet;
  products: readonly { name: string; set: NumbersSet }[];
  /** where the run's page is (the notice opens it) */
  runHref: string;
}

const hasData = (s: NumbersSet) => s.spend !== null || s.ordersIn !== null || s.confirmed !== null || s.shippedOrders !== null;
const num = (s: NumbersSet, k: SetKey, unit: "$" | "%" | "" = "") => formatStat({ unit }, s[k]);

/** One line of the report: a name and the day's numbers, the way the screens print them. No profit, no margin: those are `money.view`'s. */
const reportLine = (name: string, s: NumbersSet): string =>
  `${name}: صرف ${num(s, "spend", "$")} · طلبات ${num(s, "ordersIn")} · تكلفة الطلب ${num(s, "costPerOrder", "$")} · مؤكد ${num(s, "confirmed")}${s.confirmRate === null ? "" : ` (${num(s, "confirmRate", "%")})`} · انشحن ${num(s, "shippedOrders")} · مُسلَّم ${num(s, "delivered")}`;

export function dailySummaryReport(label: string, totals: NumbersSet, products: SummaryCtx["products"]): string {
  return [`ملخص ${label}`, "", reportLine("المجموع", totals), "", ...products.filter((x) => hasData(x.set)).map((x) => reportLine(x.name, x.set))].join("\n").slice(0, 5900);
}

export function evalDailySummary(p: SummaryParamsT, c: SummaryCtx): RecipeOutcome {
  void p;
  if (!hasData(c.totals)) return stoppedAt("s1", `ما في أرقام لـ${c.label} — ميتا مش مربوطة، والطلبات ما انسحبت ولا Claude بعتها`);
  const shown = c.products.filter((x) => hasData(x.set));
  const s1 = step("s1", `قريت أرقام ${c.label}: ${shown.length} منتج`);
  const parts: string[] = [];
  if (c.totals.ordersIn !== null && c.prev.ordersIn !== null) parts.push(`الطلبات ${num(c.totals, "ordersIn")} (قبلها ${num(c.prev, "ordersIn")})`);
  if (c.totals.costPerOrder !== null && c.prev.costPerOrder !== null) parts.push(`تكلفة الطلب ${num(c.totals, "costPerOrder", "$")} (قبلها ${num(c.prev, "costPerOrder", "$")})`);
  const s2 = step("s2", parts.length ? parts.join(" · ") : "ما في فترة قبلها للمقارنة");
  const line = [`صرف ${num(c.totals, "spend", "$")}`, `طلبات ${num(c.totals, "ordersIn")}`, `تكلفة الطلب ${num(c.totals, "costPerOrder", "$")}`].join(" · ");
  const metrics: Record<string, number | string> = { products: shown.length };
  if (c.totals.spend !== null) metrics.spend = c.totals.spend;
  if (c.totals.ordersIn !== null) metrics.orders = c.totals.ordersIn;
  if (c.totals.confirmed !== null) metrics.confirmed = c.totals.confirmed;
  if (c.totals.delivered !== null) metrics.delivered = c.totals.delivered;
  return {
    ok: true,
    steps: [s1, s2, step("s3", "")],
    summary: cut(`ملخص ${c.label}: ${line}`, 300),
    report: dailySummaryReport(c.label, c.totals, c.products),
    metrics,
    notices: [{ urgency: "yellow", audience: "owner", title: cut(`ملخص ${c.label}`, 45), body: cut(line, 200), href: c.runHref, key: `summary:${c.jobKey}:${ammanKey(c.now)}` }],
  };
}

// ───────────────────────────── remind ─────────────────────────────

export interface RemindCtx {
  jobKey: string;
  /** the run's reference: a reminder is once per run */
  ref: string;
  /** the person as the directory says (null: not there) */
  person: { key: string; name: string; active: boolean; kind: "agent" | "person"; hasTelegram: boolean } | null;
}

export function evalRemind(p: RemindParamsT, c: RemindCtx): RecipeOutcome {
  if (!c.person) return stoppedAt("s1", `«${p.person}» مش بدليل الفريق`);
  if (!c.person.active) return stoppedAt("s1", `${c.person.name} مش مفعّل بدليل الفريق`);
  const s1 = step("s1", `${c.person.name} من دليل الفريق`);
  const s2 = step("s2", c.person.hasTelegram ? "تيليجرام مربوط — بيوصله عليه وبالموقع" : "ما في رقم تيليجرام إله — بيوصله بالموقع بس");
  return {
    ok: true,
    steps: [s1, s2, step("s3", "")],
    summary: cut(`ذكّرت ${c.person.name}: ${p.text}`, 300),
    metrics: { messages: 1 },
    notices: [{ urgency: "orange", audience: c.person.key, title: cut(`تذكير: ${p.text}`, 60), body: cut(p.text, 200), href: "/tasks/team", key: `remind:${c.jobKey}:${c.ref}` }],
  };
}

/** The step «بلّغ» of an outcome once the notices were written (`created` of them were new). Nothing changes when a step before it failed. */
export function withTold(o: RecipeOutcome, created: number): RecipeOutcome {
  if (!o.ok) return o;
  return { ...o, steps: o.steps.map((s) => (s.id === "s3" ? { ...s, note: tellNote(o.notices.length, created) } : s)) };
}
