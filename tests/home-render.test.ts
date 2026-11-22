/**
 * The home as drawn (v6 · P5, docs/rebuild-v6/02-screens.md §2): «بدّها منك» (decisions, stopped runs, alerts — three shown, the rest counted), «شغّالة هلق» and «مين شغّال» (from the live answer),
 * «وين كنا وكيف صرنا» (four tiles with their words, or what is missing), «الجاي اليوم» and «آخر النتائج». Rendered on the server (no browser): the async sections are awaited and their output drawn.
 * What is held: every number arrives computed, a missing one says why, an empty section is not drawn, and no wide صاحي / نايم switch is on the page any more.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  me: { id: "u1", role: "OWNER", demo: false } as { id: string; role: string; demo: boolean } | null,
  inbox: [] as unknown[],
  alerts: [] as unknown[],
  tasks: { demo: false, stuck: { cards: [] as unknown[], total: 0 }, upcoming: { total: 0, lines: [] as unknown[] } },
  results: { demo: false, rows: [] as unknown[], hidden: 0, hiddenWhy: null as string | null },
  compare: null as unknown,
  live: undefined as unknown,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => undefined }) }));
vi.mock("@/server/auth", () => ({ currentCaller: async () => state.me }));
vi.mock("@/server/directory", () => ({ taskKeysFor: async () => null }));
vi.mock("@/server/inbox", () => ({ loadInbox: async () => state.inbox }));
vi.mock("@/lib/today-view", () => ({ loadToday: async () => ({ alerts: state.alerts }) }));
vi.mock("@/lib/tasks-view", () => ({ loadHomeTasks: async () => state.tasks, loadResults: async () => state.results }));
vi.mock("@/lib/compare-view", () => ({ loadCompare: async () => state.compare }));
vi.mock("@/components/tasks/live", () => ({ useLive: () => ({ data: state.live }) }));

import { NeedsSection, NumbersSection, ResultsSection, UpcomingSection } from "@/components/home/home-sections";
import { RunningNow, WhoWorks } from "@/components/home/live-sections";
import { homeTiles } from "@/core/compare";
import { homePlan } from "@/core/home";
import { fromApproval, type ApprovalIn } from "@/core/inbox";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import { numbersReadiness, type SourceFacts } from "@/core/numbers-readiness";
import { buildNow, type ViewJob, type ViewRun } from "@/core/tasks-view";

const NOW = new Date("2026-11-22T17:00:00.000Z");
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;

const ask = (id: string, title: string): ApprovalIn => ({ id, title, why: "ليش", numbers: [], options: [{ key: "approve", label: "وافق" }, { key: "reject", label: "ارفض" }], amount: null, urgency: "orange", kind: null, source: "mcp", workflowKey: null, expiresAt: null, postponedUntil: null, createdAt: "2026-11-22T10:00:00.000Z" });
const graph = { nodes: [{ id: "start", type: "trigger" as const, label: "بداية" }, ...["a", "b"].map((id) => ({ id, type: "step" as const, label: `خطوة ${id}`, executor: "claude_mcp" as const }))], edges: [{ from: "start", to: "a" }, { from: "a", to: "b" }] };
const job: ViewJob = { key: "stock", number: 14, name: "تنبيهات المخزون", domain: "ads", kind: "recurring", schedule: null, scheduleText: null, runsAt: null, endsAt: null, enabled: true, graceMin: 15, assigneeKey: "claude", graph };
const failedRun: ViewRun = { id: "r1", jobKey: "stock", status: "failed", trigger: "schedule", scheduledFor: null, startedAt: "2026-11-22T16:00:00.000Z", heartbeatAt: null, finishedAt: "2026-11-22T16:04:00.000Z", endReason: null, summary: null, doneBy: null, nodeStates: { a: { status: "failed", at: "2026-11-22T16:03:00.000Z", error: "ما قدرنا نقرا المخزون" } } };
const stuckCards = () => buildNow({ jobs: [job], runs: [failedRun], tasks: [], names: { claude: "Claude الرئيسي" }, now: NOW }).lanes.find((l) => l.key === "stuck")!.cards;

beforeEach(() => {
  state.me = { id: "u1", role: "OWNER", demo: false };
  state.inbox = [];
  state.alerts = [];
  state.tasks = { demo: false, stuck: { cards: [], total: 0 }, upcoming: { total: 0, lines: [] } };
  state.results = { demo: false, rows: [], hidden: 0, hiddenWhy: null };
  state.live = undefined;
});

describe("«بدّها منك»", () => {
  it("nothing waits: ONE line that says so, no number and no card", async () => {
    const out = render(await NeedsSection({ plan: homePlan("OWNER") }));
    expect(out).toContain("ما في شي بدّه منك ✓");
    expect(out).not.toContain("bg-warn px-2.5"); // the count badge
    expect(out).toContain("كل القرارات"); // the way into the inbox is always there
  });

  it("decisions come first and three are shown; the number is everything that waits and the rest is behind the links", async () => {
    state.inbox = [1, 2, 3, 4].map((n) => fromApproval(ask(`a${n}`, `قرار رقم ${n}`)));
    state.tasks.stuck = { cards: stuckCards(), total: 1 };
    state.alerts = [{ key: "k", tone: "danger", text: "الاختبارات أخدت 31% من الصرف", href: "/ads" }];
    const out = render(await NeedsSection({ plan: homePlan("OWNER") }));
    expect(out).toContain(">6<"); // 4 decisions + 1 stopped run + 1 alert
    expect(count(out, /قرار رقم \d/g)).toBeGreaterThanOrEqual(3);
    expect(out).toContain("قرار رقم 1");
    expect(out).toContain("قرار رقم 3");
    expect(out).not.toContain("قرار رقم 4");
    expect(out).toContain("كل القرارات (4)");
    expect(out).toContain("كل اللي واقف (1)");
    expect(out).toContain("و 1 تنبيه كمان بالجرس");
    expect(out).not.toContain("الاختبارات أخدت"); // the alert was beyond the first three
    expect(out).not.toContain("تنبيهات المخزون"); // so was the stopped run
  });

  it("a stopped run is the same card as in «هلق»: its number, its word, its rope and the buttons of its state", async () => {
    state.tasks.stuck = { cards: stuckCards(), total: 1 };
    const out = render(await NeedsSection({ plan: homePlan("OWNER") }));
    expect(out).toContain("تنبيهات المخزون");
    expect(out).toContain("وقفت");
    expect(out).toContain("أعد المحاولة من هون");
    expect(out).toContain('href="/tasks/stock/runs/r1"');
    expect(out).toContain('role="img"'); // the light strip
  });

  it("an alert that only informs is not drawn; one that asks something is, and opens the place that fixes it", async () => {
    state.alerts = [
      { key: "i", tone: "info", text: "معلومة بس", href: "/ads" },
      { key: "w", tone: "warn", text: "مخزون TIN01: بيكفي 4 يوم", href: "/ads?product=TIN01" },
    ];
    const out = render(await NeedsSection({ plan: homePlan("OWNER") }));
    expect(out).toContain("مخزون TIN01");
    expect(out).toContain('href="/ads?product=TIN01"');
    expect(out).not.toContain("معلومة بس");
  });

  it("a role with no inbox gets no link to it, and one that may not control a run gets no button that changes it", async () => {
    state.me = { id: "u3", role: "ANALYST", demo: false };
    state.tasks.stuck = { cards: stuckCards(), total: 1 };
    const out = render(await NeedsSection({ plan: homePlan("ANALYST") }));
    expect(out).not.toContain("كل القرارات");
    expect(out).not.toContain("أعد المحاولة");
    expect(out).toContain("شوف التشغيل");
  });
});

describe("«وين كنا وكيف صرنا»", () => {
  const facts: SourceFacts = { now: NOW.toISOString(), metaLinked: true, spendYesterday: true, omsLinked: true, omsLastPullAt: "2026-11-22T16:30:00.000Z", productsWithoutBreakeven: 0, unmappedFolders: 0, productsWithoutName: 0, stockFresh: true };
  const set = (over: Partial<NumbersSet>): NumbersSet => ({ ...Object.fromEntries(SET_KEYS.map((k) => [k, null])), ...over }) as NumbersSet;
  const compare = (cur: NumbersSet, prev: NumbersSet, f: SourceFacts = facts) => {
    const tiles = homeTiles(cur, prev, f, { days: 7, toDay: "2026-11-21" });
    return { demo: false, range: { key: "custom", from: "2026-11-15", to: "2026-11-21", days: 7 }, prev: { from: "2026-11-08", to: "2026-11-14" }, tiles, facts: f, readiness: numbersReadiness(f), allMissing: tiles.every((t) => t.now === null) };
  };

  it("four tiles: the number now, «كنا», the difference IN WORDS, the source and «مبدئي» on the rate", async () => {
    state.compare = compare(set({ costPerOrder: 2.96, ordersIn: 987, confirmRate: 57, spend: 2814 }), set({ costPerOrder: 3.42, ordersIn: 826, confirmRate: 50, spend: 3017 }));
    const out = render(await NumbersSection({ plan: homePlan("OWNER") }));
    expect(count(out, /كنا </g)).toBe(4);
    for (const words of ["أرخص 13%", "أكتر 19%", "أحسن 7 نقاط", "نزل 7%"]) expect(out, words).toContain(words);
    expect(out).toContain("تكلفة الطلب الحقيقي");
    expect(out).toContain("طلبات حقيقية باليوم");
    expect(out).toContain("الصرف باليوم");
    expect(out).toContain("402$"); // the day's average, written whole
    expect(out).toContain("مبدئي"); // the confirm rate of yesterday can still move
    expect(out).toContain("آخر 7 أيام مقابل الـ7 اللي قبلهم");
    expect(out).toContain('href="/ops"');
    expect(out).toContain("كل الأرقام");
    expect(out).not.toContain("شو ناقص لتطلع الأرقام");
  });

  it("a missing tile says WHY under a dash — never a zero", async () => {
    state.compare = compare(set({ ordersIn: 70 }), set({ ordersIn: 56 }));
    const out = render(await NumbersSection({ plan: homePlan("OWNER") }));
    expect(out).toContain("ما في صرف مسجّل للفترة");
    expect(out).toContain("أكتر 25%");
    expect(out).not.toContain("0.00$");
  });

  it("all four missing: the card «شو ناقص لتطلع الأرقام» in place of four dashes, each missing thing with its button", async () => {
    const none: SourceFacts = { ...facts, metaLinked: false, spendYesterday: false, omsLinked: false, omsLastPullAt: null, stockFresh: false, productsWithoutBreakeven: 5 };
    state.compare = compare(set({}), set({}), none);
    const out = render(await NumbersSection({ plan: homePlan("OWNER") }));
    expect(out).toContain("شو ناقص لتطلع الأرقام");
    expect(out).toContain("الصرف ناقص: ميتا مش مربوطة، وClaude ما بعت أرقام أمس");
    expect(out).toContain("5 منتجات بلا نقطة تعادل");
    expect(out).toContain("اربط ميتا");
    expect(out).toContain('href="/settings/connections"');
    expect(out).not.toContain("كنا <");
  });

  it("a role that cannot open the settings sees what is missing but no button that would lead to a closed door", async () => {
    state.me = { id: "u2", role: "ADS_MANAGER", demo: false };
    const none: SourceFacts = { ...facts, metaLinked: false, spendYesterday: false, omsLinked: false, omsLastPullAt: null, stockFresh: false, productsWithoutBreakeven: 5 };
    state.compare = compare(set({}), set({}), none);
    const out = render(await NumbersSection({ plan: homePlan("ADS_MANAGER") }));
    expect(out).toContain("الصرف ناقص: ميتا مش مربوطة");
    expect(out).not.toContain("اربط ميتا");
    expect(out).not.toContain('href="/settings/connections"');
    expect(out).toContain('href="/ads"'); // «كل الأرقام»: the ads manager has no operations place
  });
});

describe("«الجاي اليوم» and «آخر النتائج»", () => {
  const line = (n: number) => ({ id: `u${n}`, time: `2${n}:00`, jobKey: `j${n}`, number: n, name: `مهمة ${n}`, who: "Claude الرئيسي", line: null, href: `/tasks/j${n}` });

  it("the first four moments to come, with the word «جاية», and the link to the whole day with how many there are", async () => {
    state.tasks.upcoming = { total: 6, lines: [1, 2, 3, 4, 5, 6].map(line) };
    const out = render(await UpcomingSection());
    expect(count(out, /جاية/g)).toBe(4);
    expect(out).toContain("مهمة 4");
    expect(out).not.toContain("مهمة 5");
    expect(out).toContain('href="/tasks/day"');
    expect(out).toContain("جدول اليوم (6)");
  });

  it("nothing to come: the section is not drawn", async () => {
    expect(await UpcomingSection()).toBeNull();
  });

  it("the last three results, each with its word and its sentence; the rest is behind «الكل»", async () => {
    state.results.rows = [1, 2, 3, 4].map((n) => ({ id: `run:${n}`, kind: "run", title: `نتيجة ${n}`, jobKey: "j", jobNumber: n, domain: "ads", status: n === 3 ? "failed" : "ok", at: "2026-11-22T10:00:00.000Z", summary: `14 طلب نزلوا على الشحن (${n})`, hasFull: true, href: `/tasks/results/run:${n}`, empty: false, count: 1 }));
    const out = render(await ResultsSection());
    expect(out).toContain("نتيجة 3");
    expect(out).not.toContain("نتيجة 4");
    expect(out).toContain("خلصت");
    expect(out).toContain("وقفت");
    expect(out).toContain("14 طلب نزلوا على الشحن (1)");
    expect(out).toContain('href="/tasks/results"');
  });

  it("no result: the section is not drawn", async () => {
    expect(await ResultsSection()).toBeNull();
  });
});

describe("«شغّالة هلق» and «مين شغّال» — from the live answer", () => {
  const steps = [
    { id: "a", n: 1, no: "14.1", label: "اقرا", lamp: "done", note: null, startedAt: null, endedAt: null, error: null, inferred: false },
    { id: "b", n: 2, no: "14.2", label: "قارن", lamp: "run", note: null, startedAt: null, endedAt: null, error: null, inferred: false },
  ];
  const liveRun = (id: string, status: string, name: string) => ({ id, jobKey: "team", jobNumber: 10, jobName: name, status, lamp: "run", scheduledFor: null, startedAt: "2026-11-22T16:00:00.000Z", heartbeatAt: null, sentence: `هلق عند الخطوة 2 من 2 (${name})`, steps });

  it("a card for every run that is going — its number, name, rope and sentence — and none for the ones that wait or finished", () => {
    state.live = { at: NOW.toISOString(), agents: [], queue: [], runs: [liveRun("r1", "running", "جولة الفريق"), liveRun("r2", "waiting", "بانتظار قرار"), liveRun("r3", "ok", "خلصت")] };
    const out = render(h(RunningNow));
    expect(out).toContain("شغّالة هلق");
    expect(out).toContain("جولة الفريق");
    expect(out).not.toContain("بانتظار قرار");
    expect(count(out, /data-state="run"/g)).toBe(1);
    expect(out).toContain('href="/tasks/team/runs/r1"');
    expect(out).toContain('role="img"');
    expect(out).toContain("هلق عند الخطوة 2 من 2");
  });

  it("nothing going, or no answer yet: not drawn", () => {
    expect(render(h(RunningNow))).toBe("");
    state.live = { at: NOW.toISOString(), agents: [], queue: [], runs: [liveRun("r2", "waiting", "x")] };
    expect(render(h(RunningNow))).toBe("");
  });

  it("who is working: a card for each agent with the line of what the site saw; no agent, not drawn", () => {
    state.live = { at: NOW.toISOString(), agents: [{ key: "claude", name: "Claude الرئيسي", state: "running", lastSeenAt: NOW.toISOString(), queued: 0 }, { key: "muse", name: "ميوز", state: "silent", lastSeenAt: "2026-11-22T14:00:00.000Z", queued: 0 }], runs: [], queue: [] };
    const out = render(h(WhoWorks));
    expect(out).toContain("مين شغّال");
    expect(out).toContain("Claude الرئيسي");
    expect(out).toContain("ميوز");
    expect(out).toContain("ساكت من 3 ساعات");
    state.live = { at: NOW.toISOString(), agents: [], runs: [], queue: [] };
    expect(render(h(WhoWorks))).toBe("");
  });
});
