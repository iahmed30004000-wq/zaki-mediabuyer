import { describe, expect, it } from "vitest";
import { parseRange } from "@/core/dates";
import { SET_KEYS, STATS, formatStat, type NumbersSet, type ProductNumbers } from "@/core/numbers";
import { assembleTable, demoSource, type AdsTableData } from "@/lib/ads-table";
import { adsOutput, dayOutput, explainOutput, numbersHref, numbersOutput, tasksOutput, videosOutput, workflowsOutput, type NumbersLike } from "@/lib/assistant-views";
import { fmt } from "@/lib/format";
import type { BoardData } from "@/lib/videos-board";
import type { DayData } from "@/lib/day-view";
import type { TaskView } from "@/server/tasks";
import type { WorkflowCard } from "@/server/workflows";

const NOW = new Date("2026-11-15T09:00:00Z");

const set = (x: Partial<NumbersSet>): NumbersSet => ({ ...(Object.fromEntries(SET_KEYS.map((k) => [k, null])) as NumbersSet), ...x });
const product = (code: string, name: string, cur: Partial<NumbersSet>, hasData = true): ProductNumbers => ({ code, name, current: set(cur), prev: set({ costPerOrder: 4.5, spend: 100 }), avg7: set({ costPerOrder: 4.8, spend: 90 }), rejectReasons: [{ reason: "رقم غلط", count: 3 }], offers: [], breakeven: code === "TIN01" ? 6 : null, stockUrgency: null, hasData });

const numbers = (): NumbersLike => ({
  demo: false,
  range: parseRange({ d: "yesterday" }, NOW),
  label: "امبارح (2026-11-14)",
  totals: { current: set({ spend: 182.64, ordersIn: 49, costPerOrder: 3.727, confirmRate: 66.6667 }), prev: set({ costPerOrder: 4.1 }), avg7: set({ costPerOrder: 4.3 }) },
  products: [product("TRF01", "ماء الكمأة", { spend: 118.18, ordersIn: 38, costPerOrder: 3.11 }), product("TIN01", "قطرة طنين الأذن", { spend: 64.64, ordersIn: 11, costPerOrder: 5.8764 }), product("OLD01", "منتج قديم", {}, false)],
  target: 3,
});

describe("numbersOutput", () => {
  const q = { d: "yesterday" };

  it("prints every number the way «الأرقام» prints it, and keeps the raw value for calculate", () => {
    const o = numbersOutput(numbers(), { q, stats: ["costPerOrder", "confirmRate", "ordersIn"] });
    const total = (o.data as any).scopes[0];
    expect(total.scope).toBe("المجموع");
    const cost = total.stats.find((s: any) => s.key === "costPerOrder");
    expect(cost).toMatchObject({ value: 3.727, display: formatStat(STATS.find((s) => s.key === "costPerOrder")!, 3.727), source: "حقيقي" });
    expect(cost.display).toBe("3.73$");
    expect(total.stats.find((s: any) => s.key === "confirmRate").display).toBe("66.7%");
    expect(total.stats.find((s: any) => s.key === "ordersIn").display).toBe("49");
  });

  it("one scope per product that has data, none for a product that has none, and the owner's target as context", () => {
    const o = numbersOutput(numbers(), { q });
    const d = o.data as any;
    expect(d.scopes.map((s: any) => s.code)).toEqual([null, "TRF01", "TIN01"]);
    expect(d.owner_target_cost_of_real_order).toEqual({ value: 3, display: "3.00$" });
    expect(d.scopes[2].breakeven).toEqual({ value: 6, display: "6.00$" });
    expect(d.range).toMatchObject({ label: "امبارح (2026-11-14)", from: "2026-11-14", to: "2026-11-14", days: 1 });
  });

  it("one product: the scope is that product, with the reasons for rejection; with no data it says «ناقصة», not zero", () => {
    const one = numbersOutput(numbers(), { q, product: { code: "TIN01", name: "قطرة طنين الأذن" }, stats: ["costPerOrder"] });
    expect((one.data as any).scopes).toHaveLength(1);
    expect((one.data as any).scopes[0]).toMatchObject({ code: "TIN01", hasData: true, top_reject_reasons: ["رقم غلط: 3"] });
    const none = numbersOutput(numbers(), { q, product: { code: "OLD01", name: "منتج قديم" } });
    expect((none.data as any).scopes[0]).toMatchObject({ code: "OLD01", hasData: false });
    expect((none.data as any).scopes[0].note).toContain("ناقصة");
    expect(none.facts).toEqual([]);
    const gone = numbersOutput(numbers(), { q, product: { code: "NEW01", name: "منتج جديد" } });
    expect((gone.data as any).scopes[0].hasData).toBe(false);
  });

  it("compare adds the window before and the average of seven days; the default is the short list", () => {
    const o = numbersOutput(numbers(), { q, product: { code: "TRF01", name: "ماء الكمأة" }, stats: ["costPerOrder"], compare: true });
    expect((o.data as any).scopes[0].stats[0]).toMatchObject({ previous_window: "4.50$", avg_7_days: "4.80$" });
    const dflt = (numbersOutput(numbers(), { q }).data as any).scopes[0].stats.map((s: any) => s.key);
    expect(dflt).toEqual(["spend", "ordersIn", "costPerOrder", "confirmed", "confirmRate", "shippedOrders", "delivered", "expectedProfit"]);
  });

  it("facts are the lines under the answer: label with the scope and the range, the printed value, the raw one, the source link", () => {
    const o = numbersOutput(numbers(), { q, product: { code: "TIN01", name: "قطرة طنين الأذن" }, stats: ["costPerOrder"] });
    expect(o.facts).toEqual([{ label: "تكلفة الطلب الحقيقي · قطرة طنين الأذن · امبارح (2026-11-14)", value: "5.88$", raw: 5.8764, source: "numbers:d=yesterday" }]);
    expect(o.sources).toEqual([{ id: "numbers:d=yesterday", label: "الأرقام · امبارح (2026-11-14)", href: "/?tab=numbers&d=yesterday" }]);
    expect(numbersHref({ d: "custom", from: "2026-11-01", to: "2026-11-07" })).toBe("/?tab=numbers&d=custom&from=2026-11-01&to=2026-11-07");
  });

  it("a key that is not a number of the screen is dropped; repeats are one", () => {
    const o = numbersOutput(numbers(), { q, stats: ["costPerOrder", "costPerOrder", "nope" as never] });
    expect((o.data as any).scopes[0].stats).toHaveLength(1);
  });
});

describe("adsOutput", () => {
  const range = parseRange({ d: "yesterday" }, NOW);
  const table = (): AdsTableData => assembleTable(demoSource("2026-11-15", NOW.getTime()), range, NOW, { fx: 0.01, testLimit: 0.2, stepPct: 0.2, target: 3, breakeven: () => null, rulesMissing: false });
  const q = { d: "yesterday" };

  it("a short list of the rows that are running, the biggest spender first, with the id the change tool needs", () => {
    const o = adsOutput(table(), { q });
    const d = o.data as any;
    expect(d.rows.length).toBeGreaterThan(0);
    expect(d.rows.length).toBeLessThanOrEqual(8);
    expect(d.shown).toBe(d.rows.length);
    expect(d.matching).toBeGreaterThanOrEqual(d.shown);
    for (const r of d.rows) {
      expect(r.id).toBeTruthy();
      expect(["campaign", "adset", "ad"]).toContain(r.level);
      expect(r.spend).toHaveProperty("display");
    }
    const spends = d.rows.map((r: any) => r.spend.value ?? -1);
    expect(spends).toEqual([...spends].sort((a, b) => b - a));
    expect(o.sources[0]).toMatchObject({ href: "/ads?d=yesterday" });
  });

  it("filters by level and sorts by cost (the cheapest first, the unknown last)", () => {
    const o = adsOutput(table(), { q, level: "ad", status: "all", sort: "costPerOrder", limit: 15 });
    const rows = (o.data as any).rows as { level: string; cost_per_real_order: { value: number | null } }[];
    expect(rows.every((r) => r.level === "ad")).toBe(true);
    const costs = rows.map((r) => r.cost_per_real_order.value);
    const known = costs.filter((c): c is number => c !== null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    expect(costs.slice(known.length).every((c) => c === null)).toBe(true);
  });

  it("the money is printed by the table's own formatter", () => {
    const row = (adsOutput(table(), { q, limit: 1 }).data as any).rows[0];
    expect(row.spend.display).toBe(fmt(row.spend.value, "$"));
    expect(row.confirm_rate.display).toBe(fmt(row.confirm_rate.value, "%"));
  });
});

describe("videosOutput", () => {
  const board = (): BoardData => ({
    demo: false,
    today: "2026-11-15",
    target: 3,
    typedMinSpend: null,
    hermes: { api: true, chat: false },
    totals: { videos: 31, winners: 2, tired: 1, openRequests: 1 },
    products: [
      {
        code: "TIN01",
        name: "قطرة طنين الأذن",
        bank: { count: 31, target: 50, pct: 62, short: 19, byState: { bank: 20, testing: 6 } },
        minSpend: 6,
        minSpendFrom: "target",
        breakeven: 6,
        winners: [{ key: "J1|V2", label: "V2", days: 5, spend: 22.5, orders: 5, costPerOrder: 4.5 } as never],
        learning: [],
        rest: [],
        tiredCount: 1,
        requests: [{} as never],
      },
    ],
  });

  it("the bank against fifty, the winners with their cost, how many are tired — and the fact lines", () => {
    const o = videosOutput(board(), { product: null });
    const p = (o.data as any).products[0];
    expect(p).toMatchObject({ code: "TIN01", bank: { count: 31, target: 50, short: 19 }, tired_count: 1, open_requests: 1, winners_count: 1 });
    expect(p.winners[0].cost_per_real_order).toEqual({ value: 4.5, display: "4.50$" });
    expect(o.facts.map((f) => f.value)).toEqual(["31", "1"]);
  });

  it("one product only", () => {
    expect((videosOutput(board(), { product: { code: "NOPE", name: "x" } }).data as any).products).toEqual([]);
  });
});

describe("the day, the tasks, the workflows", () => {
  it("the day: the summary the code wrote and the counts", () => {
    const d: DayData = { demo: false, day: "2026-11-14", today: "2026-11-15", title: "السبت 14 نوفمبر", state: "past", done: [{ key: "claude", label: "Claude", items: [{ at: "2026-11-14T06:00:00Z", actor: "claude", kind: "run", text: "شغّل فحص الصباح" }] }], planned: [], counts: { done: 1, planned: 0 } };
    const o = dayOutput(d);
    expect((o.data as any).summary).toContain("شغّل فحص الصباح");
    expect(o.facts.map((f) => [f.label, f.value])).toEqual([["اللي انعمل · السبت 14 نوفمبر", "1"], ["المخطّط · السبت 14 نوفمبر", "0"]]);
    expect(o.sources[0]).toMatchObject({ href: "/tasks/day?day=2026-11-14" });
  });

  it("the tasks: counted by column in the owner's words, with the ids, and the person's name instead of a key", () => {
    const t = (id: string, status: string, assignee: string | null): TaskView => ({ id, title: `مهمة ${id}`, note: null, status, assignee, executor: null, dueAt: "2026-11-16T00:00:00.000Z", priority: "high", board: "main", linkType: null, linkId: null, source: "ui", createdAt: "", updatedAt: "" });
    const o = tasksOutput([t("a", "new", "muse"), t("b", "new", null), t("c", "doing", "abdullah")]);
    const d = o.data as any;
    expect(d.by_status).toEqual({ جديد: 2, شغّال: 1 });
    expect(d.tasks[0]).toMatchObject({ id: "a", assignee: "ميوز", due: "2026-11-16", board: "الرئيسية", status: "جديد", status_key: "new" });
    expect(o.facts).toEqual([
      { label: "مهام «جديد»", value: "2", raw: 2, source: "tasks:board" },
      { label: "مهام «شغّال»", value: "1", raw: 1, source: "tasks:board" },
    ]);
  });

  it("the workflows: the list, one drawing with ids and joins, and the keys that exist when the key does not", () => {
    const card = { key: "morning", name: "فحص الصباح", description: null, enabled: true, schedule: "0 8 * * *", version: 3, nextRun: "2026-11-16T05:00:00.000Z", lastRun: { status: "ok", startedAt: "2026-11-15T05:00:00.000Z", summary: "تمام" }, live: null, graph: { nodes: [{ id: "s", type: "trigger", label: "بداية" }, { id: "r", type: "step", label: "قراءة", executor: "claude_mcp" }], edges: [{ from: "s", to: "r" }] } } as unknown as WorkflowCard;
    expect((workflowsOutput([card]).data as any).workflows[0]).toMatchObject({ key: "morning", steps: 2, last_status: "ok", running_now: false });
    const one = workflowsOutput([card], "morning").data as any;
    expect(one.nodes.map((n: any) => n.id)).toEqual(["s", "r"]);
    expect(one.edges).toEqual([{ from: "s", to: "r", label: null }]);
    const missing = workflowsOutput([card], "nope");
    expect(missing.isError).toBe(true);
    expect((missing.data as any).error).toContain("morning");
  });
});

describe("explain", () => {
  it("a screen's own words; without any argument it is the screen the owner is on", () => {
    const o = explainOutput({ place: "ads" }, null);
    expect((o.data as any).screen).toMatchObject({ key: "ads", name: "الإعلانات" });
    expect((o.data as any).screen.what).toContain("الحملات");
    // the place the owner is on (the key the page header knows), the old names of the places a model may still use, and the two screens that are no place
    expect((explainOutput({}, "tasks").data as any).screen.key).toBe("tasks");
    expect((explainOutput({ place: "work" }, null).data as any).screen).toMatchObject({ key: "tasks", name: "المهام" });
    expect((explainOutput({ place: "ops" }, null).data as any).screen.key).toBe("numbers");
    expect((explainOutput({}, "inbox").data as any).screen).toMatchObject({ key: "inbox", name: "بانتظارك" });
    expect((explainOutput({}, "settings").data as any).screen.key).toBe("settings");
    expect(explainOutput({ place: "nowhere" }, null).isError).toBe(true);
    // a page that is none of them (a stale address) has no screen text, and that is no error
    expect((explainOutput({}, "videos").data as any).screen).toBeUndefined();
    expect((explainOutput({}, null).data as any).screen).toBeUndefined();
  });

  it("a number's formula, found by its key or by its name, with the source in words", () => {
    const byKey = (explainOutput({ term: "costPerOrder" }, null).data as any).terms[0];
    expect(byKey).toMatchObject({ name: "تكلفة الطلب الحقيقي", source: "حقيقي" });
    expect(byKey.formula).toContain("الصرف الفعلي");
    const byName = (explainOutput({ term: "نسبة التأكيد" }, null).data as any).terms.map((t: any) => t.key);
    expect(byName).toContain("confirmRate");
    expect(explainOutput({ term: "ما في هيك مصطلح أبداً" }, null).isError).toBe(true);
    expect(explainOutput({ place: "nowhere" }, null).isError).toBe(true);
  });
});
