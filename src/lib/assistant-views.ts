/**
 * What the assistant's tools hand back (v3 · H), built from the very objects the screens are drawn from — so «كم كلفة الطلب
 * الحقيقي امبارح» is the dashboard's number, printed by the same formatter. Pure: the tools in src/server/assistant load the
 * data (the screens' own loaders) and pass it here. Each builder returns
 *   data     what the model reads (the numbers are printed: `display` is what it must copy, `value` is what `calculate` takes),
 *   facts    the lines of «الأرقام اللي جاوبت منها» under the answer,
 *   sources  the screens the numbers live on, as links.
 */
import { COLUMNS, type Level, type MetricKey } from "@/core/ads-table";
import { normalizeAr, toolData, toolError, type Fact, type RangeQuery, type SourceRef, type ToolOutput } from "@/core/assistant";
import type { Range } from "@/core/dates";
import { STATS, formatStat, type NumbersSet, type ProductNumbers, type SetKey, type StatDef } from "@/core/numbers";
import { TASK_BOARDS, TASK_COLUMNS, assigneeName } from "@/core/tasks";
import { BANK_TARGET } from "@/core/video-board";
import { summaryOfDay } from "@/core/day";
import type { AdsTableData, TableRow } from "./ads-table";
import type { DayData } from "./day-view";
import { fmt } from "./format";
import { GLOSSARY, SOURCE_AR, type Term } from "./glossary";
import { PAGE_GUIDE } from "./guide";
import { PLACES } from "./nav";
import type { BoardData } from "./videos-board";
import type { TaskView } from "@/server/tasks";
import type { WorkflowCard } from "@/server/workflows";

const GLOSS = GLOSSARY as Record<string, Term>;

/** A number printed once, carrying both: the raw value (for `calculate`) and the text to copy. */
const num = (value: number | null | undefined, unit: "$" | "%" | "x" | "" = "") => ({ value: value ?? null, display: fmt(value, unit) });

const qs = (q: RangeQuery) => (q.d === "custom" ? `d=custom&from=${q.from}&to=${q.to}` : `d=${q.d}`);
export const numbersHref = (q: RangeQuery) => `/?tab=numbers&${qs(q)}`;
export const adsHref = (q: RangeQuery) => `/ads?${qs(q)}`;

// ───────────────────────────── «الأرقام» ─────────────────────────────

export interface NumbersLike {
  demo: boolean;
  range: Range;
  label: string;
  totals: { current: NumbersSet; prev: NumbersSet; avg7: NumbersSet };
  products: ProductNumbers[];
  target: number | null;
}

/** What a question gets by default; the model may name any of the thirty-one by key. */
export const DEFAULT_STATS: SetKey[] = ["spend", "ordersIn", "costPerOrder", "confirmed", "confirmRate", "shippedOrders", "delivered", "expectedProfit"];

/** «key = label (unit)» for every number of the screen — the tool's description says it so the model picks the right key. */
export const STATS_GUIDE = STATS.map((s) => `${s.key} = ${s.label}${s.unit ? ` (${s.unit})` : ""}`).join(" · ");

const STAT = new Map<SetKey, StatDef>(STATS.map((s) => [s.key, s]));
const MAX_PRODUCTS = 12;

const sourceOf = (def: StatDef) => SOURCE_AR[GLOSS[def.term]?.source ?? "truth"];

function statRow(def: StatDef, cur: NumbersSet, prev: NumbersSet, avg: NumbersSet, compare: boolean) {
  return {
    key: def.key,
    label: def.label,
    value: cur[def.key],
    display: formatStat(def, cur[def.key]),
    source: sourceOf(def),
    ...(compare ? { previous_window: formatStat(def, prev[def.key]), avg_7_days: formatStat(def, avg[def.key]) } : {}),
  };
}

/**
 * The numbers screen for a range: the total and every product (or the one asked for). `product` is already resolved by the
 * caller (it may have no data in the range — then it says so, it is not «missing»).
 */
export function numbersOutput(d: NumbersLike, o: { q: RangeQuery; product?: { code: string; name: string } | null; stats?: SetKey[]; compare?: boolean }): ToolOutput {
  const keys = [...new Set(o.stats?.length ? o.stats : DEFAULT_STATS)].filter((k) => STAT.has(k));
  const defs = keys.map((k) => STAT.get(k)!);
  const compare = !!o.compare;
  const source: SourceRef = { id: `numbers:${qs(o.q)}`, label: `الأرقام · ${d.label}`, href: numbersHref(o.q) };
  const facts: Fact[] = [];
  const scopes: Record<string, unknown>[] = [];

  const add = (scope: string, code: string | null, cur: NumbersSet, prev: NumbersSet, avg: NumbersSet, extra: Record<string, unknown> = {}) => {
    const stats = defs.map((def) => statRow(def, cur, prev, avg, compare));
    for (const s of stats) facts.push({ label: `${s.label} · ${scope} · ${d.label}`, value: s.display, raw: s.value, source: source.id });
    scopes.push({ scope, code, hasData: true, stats, ...extra });
  };

  if (o.product) {
    const p = d.products.find((x) => x.code === o.product!.code);
    if (!p || !p.hasData) {
      scopes.push({ scope: o.product.name, code: o.product.code, hasData: false, note: "ما في أي أرقام انبعتت لهالمنتج بهالفترة (صرف · طلبات · شحن) — مش صفر، ناقصة." });
    } else {
      add(p.name, p.code, p.current, p.prev, p.avg7, { breakeven: p.breakeven === null ? null : num(p.breakeven, "$"), top_reject_reasons: p.rejectReasons.map((r) => `${r.reason}: ${r.count}`) });
    }
  } else {
    add("المجموع", null, d.totals.current, d.totals.prev, d.totals.avg7);
    for (const p of d.products.filter((x) => x.hasData).slice(0, MAX_PRODUCTS)) add(p.name, p.code, p.current, p.prev, p.avg7, { breakeven: p.breakeven === null ? null : num(p.breakeven, "$") });
  }

  return toolData(
    {
      range: { label: d.label, from: d.range.from, to: d.range.to, days: d.range.days },
      owner_target_cost_of_real_order: d.target === null ? null : num(d.target, "$"),
      scopes,
      ...(d.demo ? { note: "بيانات تجريبية" } : {}),
    },
    { facts, sources: [source] },
  );
}

// ───────────────────────────── a week, a month ─────────────────────────────

/** A product needs at least this many orders in the window to be called the cheapest or the dearest — one lucky order is not a ranking. */
export const SUMMARY_MIN_ORDERS = 5;
const SUMMARY_STATS: SetKey[] = ["spend", "ordersIn", "costPerOrder", "confirmed", "confirmRate", "delivered", "expectedProfit"];

/**
 * A week or a month in one answer: the totals against the window just before it (and the 7-day average), and the products ranked
 * by what a real order cost them — the cheapest three and the dearest three among those with enough orders. Every number is
 * printed by the code; the model only says it in words.
 */
export function summaryOutput(d: NumbersLike, o: { q: RangeQuery; period: "week" | "month" }): ToolOutput {
  const base = numbersOutput(d, { q: o.q, compare: true, stats: SUMMARY_STATS });
  const ranked = d.products.filter((p) => p.hasData && p.current.costPerOrder !== null && (p.current.ordersIn ?? 0) >= SUMMARY_MIN_ORDERS).sort((a, b) => a.current.costPerOrder! - b.current.costPerOrder!);
  const cheapest = ranked.slice(0, 3);
  const dearest = ranked.slice(3).slice(-3).reverse();
  const row = (p: ProductNumbers) => ({ name: p.name, code: p.code, orders: num(p.current.ordersIn), cost_per_real_order: num(p.current.costPerOrder, "$"), spend: num(p.current.spend, "$") });
  const source = base.sources[0]!;
  const facts: Fact[] = [...base.facts];
  for (const p of [...cheapest, ...dearest]) facts.push({ label: `تكلفة الطلب الحقيقي · ${p.name} · ${d.label}`, value: fmt(p.current.costPerOrder, "$"), raw: p.current.costPerOrder, source: source.id });
  const quiet = d.products.filter((p) => p.hasData && (p.current.ordersIn ?? 0) < SUMMARY_MIN_ORDERS).length;
  return toolData(
    {
      ...(base.data as Record<string, unknown>),
      period: o.period === "week" ? "آخر 7 أيام" : "آخر 30 يوم",
      ranking: {
        min_orders_to_rank: SUMMARY_MIN_ORDERS,
        cheapest: cheapest.map(row),
        dearest: dearest.map(row),
        not_ranked: quiet ? `${quiet} منتج أقل من ${SUMMARY_MIN_ORDERS} طلبات بهالفترة — ما انحسبوا بالترتيب` : null,
      },
    },
    { facts, sources: base.sources },
  );
}

// ───────────────────────────── «الإعلانات» ─────────────────────────────

const LEVEL_AR: Record<Level, string> = { campaign: "حملة", adset: "مجموعة", ad: "إعلان" };
const STATUS_AR: Record<string, string> = { active: "شغّال", paused: "موقوف", learning: "بالتعلّم", untested: "بلا اختبار", rejected: "مرفوض من ميتا" };
const METRIC: Record<MetricKey, { label: string; unit: "$" | "%" | "x" | "" }> = Object.fromEntries(COLUMNS.filter((c) => c.metric).map((c) => [c.metric!, { label: c.label, unit: c.unit }])) as Record<MetricKey, { label: string; unit: "$" | "%" | "x" | "" }>;

export const ADS_SORTS = ["spend", "costPerOrder", "orders", "profit"] as const;
export type AdsSort = (typeof ADS_SORTS)[number];

const flatten = (rows: TableRow[], out: TableRow[] = []): TableRow[] => {
  for (const r of rows) {
    out.push(r);
    flatten(r.children, out);
  }
  return out;
};

/** The ads table as a short list: the rows worth a sentence, with the id the change tool needs. */
export function adsOutput(d: AdsTableData, o: { q: RangeQuery; status?: "active" | "all"; product?: { code: string; name: string } | null; level?: Level; sort?: AdsSort; limit?: number }): ToolOutput {
  const source: SourceRef = { id: `ads:${qs(o.q)}`, label: `الإعلانات · ${d.label}`, href: adsHref(o.q) };
  let rows = flatten(d.rows);
  if (o.level) rows = rows.filter((r) => r.level === o.level);
  if ((o.status ?? "active") === "active") rows = rows.filter((r) => r.status === "active" || r.status === "learning");
  if (o.product) rows = rows.filter((r) => r.product?.code === o.product!.code);
  const sort = o.sort ?? "spend";
  const val = (r: TableRow) => r.m[sort];
  rows = [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return sort === "costPerOrder" ? x - y : y - x;
  });
  const limit = Math.min(Math.max(o.limit ?? 8, 1), 15);
  const shown = rows.slice(0, limit);
  const facts: Fact[] = [];
  const out = shown.map((r) => {
    const spend = num(r.m.spend, "$");
    const orders = num(r.m.orders);
    const cost = num(r.m.costPerOrder, "$");
    for (const [k, v] of [["الصرف", spend], ["الطلبات الحقيقية", orders], ["تكلفة الطلب الحقيقي", cost]] as const) facts.push({ label: `${k} · ${r.name} · ${d.label}`, value: v.display, raw: v.value, source: source.id });
    return {
      id: r.id,
      level: r.level,
      level_ar: LEVEL_AR[r.level],
      name: r.name,
      status: STATUS_AR[r.status] ?? r.status,
      product: r.product?.name ?? null,
      daily_budget: r.budget === undefined ? null : num(r.budget, "$"),
      days_running: r.days,
      spend,
      real_orders: orders,
      cost_per_real_order: cost,
      confirm_rate: num(r.m.confirmRate, "%"),
      estimated_profit: num(r.m.profit, "$"),
      can_raise_budget: !!r.canScale,
    };
  });
  return toolData(
    {
      range: { label: d.label, from: d.range.from, to: d.range.to },
      owner_target_cost_of_real_order: d.target === null ? null : num(d.target, "$"),
      matching: rows.length,
      shown: out.length,
      sorted_by: METRIC[sort]?.label ?? sort,
      rows: out,
      ...(d.demo ? { note: "بيانات تجريبية" } : {}),
    },
    { facts, sources: [source] },
  );
}

// ───────────────────────────── «الفيديوهات» ─────────────────────────────

/** Each product's bank against fifty, its winners and how many are tired — the board's own numbers. */
export function videosOutput(d: BoardData, o: { product?: { code: string; name: string } | null }): ToolOutput {
  const source: SourceRef = { id: "videos:board", label: "الفيديوهات · حسب المنتج", href: "/ads/videos" };
  const facts: Fact[] = [];
  const products = d.products.filter((p) => !o.product || p.code === o.product.code);
  const out = products.map((p) => {
    facts.push({ label: `فيديوهات البنك · ${p.name} (من ${BANK_TARGET})`, value: String(p.bank.count), raw: p.bank.count, source: source.id });
    facts.push({ label: `فيديوهات تعبانة · ${p.name}`, value: String(p.tiredCount), raw: p.tiredCount, source: source.id });
    return {
      code: p.code,
      name: p.name,
      bank: { count: p.bank.count, target: p.bank.target, short: p.bank.short, by_state: p.bank.byState },
      min_spend_to_rank: p.minSpend === null ? null : num(p.minSpend, "$"),
      winners: p.winners.slice(0, 5).map((v) => ({ key: v.key, label: v.label, days: v.days, spend: num(v.spend, "$"), real_orders: num(v.orders), cost_per_real_order: num(v.costPerOrder, "$") })),
      winners_count: p.winners.length,
      tired_count: p.tiredCount,
      learning_count: p.learning.length,
      open_requests: p.requests.length,
    };
  });
  return toolData({ target_bank: BANK_TARGET, totals: d.totals, products: out, ...(d.demo ? { note: "بيانات تجريبية" } : {}) }, { facts, sources: [source] });
}

// ───────────────────────────── «الإنجاز» وليوم ─────────────────────────────

/** One Amman day: what was done and what is planned, as the code wrote it (the same lines as the Telegram summary). */
export function dayOutput(d: DayData): ToolOutput {
  const source: SourceRef = { id: `day:${d.day}`, label: `جدول اليوم · ${d.title}`, href: `/tasks/day?day=${d.day}` };
  const facts: Fact[] = [
    { label: `اللي انعمل · ${d.title}`, value: String(d.counts.done), raw: d.counts.done, source: source.id },
    { label: `المخطّط · ${d.title}`, value: String(d.counts.planned), raw: d.counts.planned, source: source.id },
  ];
  return toolData({ day: d.day, state: d.state, counts: d.counts, summary: summaryOfDay(d.title, d.done, d.planned, d.demo), ...(d.demo ? { note: "بيانات تجريبية" } : {}) }, { facts, sources: [source] });
}

// ───────────────────────────── «المهام» ─────────────────────────────

const COLUMN_AR: Record<string, string> = Object.fromEntries(TASK_COLUMNS.map((c) => [c.key, c.label]));
const BOARD_AR: Record<string, string> = Object.fromEntries(TASK_BOARDS.map((b) => [b.key, b.label]));

export function tasksOutput(list: TaskView[], boards: { key: string; label: string }[] = []): ToolOutput {
  const boardName = (k: string) => boards.find((b) => b.key === k)?.label ?? BOARD_AR[k] ?? k;
  const source: SourceRef = { id: "tasks:board", label: "المهام", href: "/tasks/team" };
  const by: Record<string, number> = {};
  for (const t of list) by[COLUMN_AR[t.status] ?? t.status] = (by[COLUMN_AR[t.status] ?? t.status] ?? 0) + 1;
  const facts: Fact[] = Object.entries(by).map(([label, n]) => ({ label: `مهام «${label}»`, value: String(n), raw: n, source: source.id }));
  return toolData(
    {
      count: list.length,
      by_status: by,
      // the boards (the owner's own too): name → key, which create_task takes
      boards: boards.map((b) => ({ key: b.key, name: b.label })),
      tasks: list.slice(0, 30).map((t) => ({ id: t.id, title: t.title, status: COLUMN_AR[t.status] ?? t.status, status_key: t.status, assignee: assigneeName(t.assignee), due: t.dueAt?.slice(0, 10) ?? null, priority: t.priority, board: boardName(t.board), note: t.note })),
    },
    { facts, sources: [source] },
  );
}

// ───────────────────────────── المهام (الورك فلو بالكود) ─────────────────────────────

export function workflowsOutput(cards: WorkflowCard[], key?: string): ToolOutput {
  const source: SourceRef = { id: key ? `workflow:${key}` : "workflows", label: key ? "المهمة وخطواتها" : "المهام", href: key ? `/tasks/${encodeURIComponent(key)}` : "/tasks/all" };
  if (key) {
    const c = cards.find((x) => x.key === key);
    if (!c) return toolError(`ما في مهمة بالمفتاح «${key}». المفاتيح: ${cards.map((x) => x.key).join("، ")}`);
    return toolData(
      {
        key: c.key,
        name: c.name,
        description: c.description,
        enabled: c.enabled,
        schedule: c.schedule,
        version: c.version,
        nodes: c.graph.nodes.map((n) => ({ id: n.id, type: n.type, label: n.label, executor: n.executor ?? null, permission: n.permission ?? null })),
        edges: c.graph.edges.map((e) => ({ from: e.from, to: e.to, label: e.label ?? null })),
        last_run: c.lastRun ? { status: c.lastRun.status, at: c.lastRun.startedAt, summary: c.lastRun.summary } : null,
      },
      { sources: [source] },
    );
  }
  return toolData(
    { count: cards.length, workflows: cards.map((c) => ({ key: c.key, name: c.name, enabled: c.enabled, schedule: c.schedule, next_run: c.nextRun, steps: c.graph.nodes.length, last_status: c.lastRun?.status ?? null, running_now: !!c.live })) },
    { sources: [source] },
  );
}

// ───────────────────────────── «اشرح» ─────────────────────────────

const PLACE_KEYS = [...PLACES.map((p) => p.key), "inbox", "settings"];
/** The names the old map used for its places: a model that learned them (or a saved conversation) still gets the right page. */
const OLD_PLACE: Record<string, string> = { work: "tasks", ops: "numbers", products: "numbers", workflow: "tasks", today: "home" };

/** A screen's own explanation, and the formulas behind its numbers («قاعدة الاحتساب»). Nothing here is a number of the owner's. */
export function explainOutput(a: { place?: string; term?: string }, current: string | null): ToolOutput {
  const result: Record<string, unknown> = {};
  const asked = a.place ?? (a.term ? undefined : current ?? undefined);
  const wantPlace = asked ? (OLD_PLACE[asked] ?? asked) : undefined;
  if (wantPlace) {
    const p = PLACES.find((x) => x.key === wantPlace || x.label === wantPlace);
    // the decisions list and the settings have a guide but are no place of the map
    const other = !p && (wantPlace === "inbox" || wantPlace === "settings") ? wantPlace : null;
    if (!p && !other && a.place) return toolError(`الصفحة «${wantPlace}» مش معروفة. الصفحات: ${PLACE_KEYS.join(" · ")}`);
    if (p || other) {
      const key = p ? p.key : (other as "inbox" | "settings");
      const g = PAGE_GUIDE[key];
      result.screen = { key, name: p ? p.label : other === "inbox" ? "بانتظارك" : "الإعدادات", question: p ? p.question : undefined, what: g.what, next: g.next, parts: g.tour.map((t) => `${t.title}: ${t.text}`) };
    }
  }
  if (a.term) {
    const q = normalizeAr(a.term);
    const hits = Object.entries(GLOSS)
      .filter(([k, t]) => k.toLowerCase() === a.term!.toLowerCase() || normalizeAr(t.name).includes(q) || q.includes(normalizeAr(t.name)))
      .slice(0, 5);
    if (!hits.length) return toolError(`ما لقيت مصطلح «${a.term}» بالدليل.`);
    result.terms = hits.map(([key, t]) => ({ key, name: t.name, formula: t.formula, meaning: t.meaning, source: SOURCE_AR[t.source] }));
  }
  return toolData(result, { sources: [{ id: "guide", label: "الدليل والمصطلحات", href: "/settings/advanced/guide" }] });
}

