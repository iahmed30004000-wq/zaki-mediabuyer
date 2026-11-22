/**
 * «المهام» as drawn (v6 · P3): the cards, the lanes, the board, the report. The rope of a card is the run's own stored states — one lamp per step, the label is the sentence — and no screen
 * writes a bracket of JSON or a tool's name. Rendered on the server (no browser); the router and the toast are stand-ins.
 */
import { createElement as h } from "react";
import { renderToStaticMarkup as render } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined, push: () => undefined, replace: () => undefined }), usePathname: () => "/tasks", useSearchParams: () => new URLSearchParams() }));
vi.mock("@/components/ui/toast", () => ({ useToast: () => ({ toast: () => undefined }) }));

import { AllList } from "@/components/tasks/all-list";
import { DayBoardView, DoneLines } from "@/components/tasks/day-board-view";
import { NowLanes } from "@/components/tasks/now-lanes";
import { ReportView } from "@/components/tasks/report-view";
import { RunCard } from "@/components/tasks/run-card";
import { collapseDayItems } from "@/core/day-collapse";
import { buildAll, buildDayBoard, buildNow, type ViewJob, type ViewRun } from "@/core/tasks-view";
import { workdayOf } from "@/core/timeline";

const NOW = new Date("2026-11-22T17:00:00.000Z");
const at = (hhmm: string) => `2026-11-22T${hhmm}:00.000Z`;
const graph = { nodes: [{ id: "start", type: "trigger" as const, label: "بداية" }, ...["a", "b", "c", "d"].map((id) => ({ id, type: "step" as const, label: `خطوة ${id}`, executor: "claude_mcp" as const }))], edges: [["start", "a"], ["a", "b"], ["b", "c"], ["c", "d"]].map(([from, to]) => ({ from: from!, to: to! })) };
const job = (key: string, over: Partial<ViewJob> = {}): ViewJob => ({ key, number: 1, name: `مهمة ${key}`, domain: "ads", kind: "recurring", schedule: null, scheduleText: null, runsAt: null, endsAt: null, enabled: true, graceMin: 15, assigneeKey: "claude", graph, ...over });
const run = (id: string, jobKey: string, status: string, over: Partial<ViewRun> = {}): ViewRun => ({ id, jobKey, status, trigger: "schedule", scheduledFor: null, startedAt: at("16:00"), heartbeatAt: null, finishedAt: null, endReason: null, summary: null, doneBy: null, nodeStates: {}, ...over });
const names = { claude: "Claude الرئيسي" };
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length;
// a lamp of the strip is size 14 (`size-3.5`); the word's own lamp is 10, so it is not counted
const lamps = (s: string) => count(s, /<span[^>]*rounded-full[^>]*size-3\.5/g);

describe("a run card", () => {
  const states = { a: { status: "done" as const, at: at("16:01") }, b: { status: "done" as const, at: at("16:02") }, c: { status: "failed" as const, at: at("16:03"), error: "ما قدرنا نقرا المخزون" } };

  it("the rope has one lamp per step as stored; its text is the sentence; the word, the name and the buttons of the state are there", () => {
    const d = buildNow({ jobs: [job("stock", { name: "تنبيهات المخزون", number: 14 })], runs: [run("r1", "stock", "failed", { startedAt: at("16:00"), finishedAt: at("16:04"), nodeStates: states })], tasks: [], names, now: NOW });
    const card = d.lanes.find((l) => l.key === "stuck")!.cards[0]!;
    const out = render(h(RunCard, { card, canControl: true }));
    expect(lamps(out)).toBe(4); // the four steps
    expect(out).toContain('role="img"');
    expect(out).toContain(`aria-label="${card.sentence}"`);
    expect(card.sentence).toBe("وقفت عند 3: ما قدرنا نقرا المخزون");
    expect(out).toContain("تنبيهات المخزون");
    expect(out).toContain("وقفت"); // the word of the dictionary
    expect(out).toContain("أعد المحاولة من هون");
    expect(out).toContain("تخطّى هالخطوة");
    expect(out).toContain(`href="/tasks/stock/runs/r1"`);
    // the state is shown by the lamps themselves: two done, one failed, one not reached
    expect(count(out, /bg-ok/g)).toBeGreaterThanOrEqual(2);
    expect(out).toContain("bg-danger");
  });

  it("a person who may not control sees the link to the run and no button that changes it", () => {
    const d = buildNow({ jobs: [job("stock")], runs: [run("r1", "stock", "failed", { startedAt: at("16:00"), finishedAt: at("16:04"), nodeStates: states })], tasks: [], names, now: NOW });
    const out = render(h(RunCard, { card: d.lanes.find((l) => l.key === "stuck")!.cards[0]!, canControl: false }));
    expect(out).toContain("شوف التشغيل");
    expect(out).not.toContain("أعد المحاولة");
    expect(out).not.toContain("تخطّى هالخطوة");
  });

  it("an inferred run is drawn green WITHOUT a halo — the site did not see the steps", () => {
    const inferred = { a: { status: "done" as const, at: at("16:01"), inferred: true as const }, b: { status: "done" as const, at: at("16:01"), inferred: true as const }, c: { status: "done" as const, at: at("16:01"), inferred: true as const }, d: { status: "done" as const, at: at("16:01"), inferred: true as const } };
    const d = buildNow({ jobs: [job("j")], runs: [run("r1", "j", "waiting", { nodeStates: { ...inferred, d: { status: "approval", at: at("16:01") } } })], tasks: [], names, now: NOW });
    const out = render(h(RunCard, { card: d.lanes[0]!.cards[0]!, canControl: true }));
    expect(count(out, /shadow-lamp-ok/g)).toBe(0); // the three inferred ones have no halo
    expect(out).toContain("animate-blink"); // the step that needs the owner blinks
    expect(out).toContain("شوف القرار");
  });

  it("a missed slot says «فاتت» once (the word) and its reason once — and offers run-now and dismiss", () => {
    const d = buildNow({ jobs: [job("team", { name: "جولة الفريق" })], runs: [run("m1", "team", "missed", { scheduledFor: at("14:00"), startedAt: at("14:20") })], tasks: [], names, now: NOW });
    const out = render(h(RunCard, { card: d.lanes.find((l) => l.key === "missed")!.cards[0]!, canControl: true }));
    expect(count(out, /فاتت/g)).toBe(1);
    expect(out).toContain("ما وصل أي تسجيل");
    expect(out).toContain("شغّلها هلق");
    expect(out).toContain("تجاهل");
  });
});

describe("the lanes", () => {
  it("nothing to show says so, with the next step — no empty lanes drawn", () => {
    const out = render(h(NowLanes, { data: { lanes: [], needs: 0, day: "2026-11-22" }, canControl: true }));
    expect(out).toContain("ما في شي واقف ولا شغّال هلق");
    expect(out).toContain("/tasks/day");
  });

  it("a lane has its lamp, its title and its count; the done lane says how many in all", () => {
    const jobs = [job("night")];
    const done = Array.from({ length: 7 }, (_, i) => run(`d${i}`, "night", "ok", { startedAt: at(`1${i}:00`), finishedAt: at(`1${i}:05`), summary: `نتيجة ${i}` }));
    const data = buildNow({ jobs, runs: [...done, run("r", "night", "running", { nodeStates: { a: { status: "running", at: at("16:30") } } })], tasks: [], names, now: NOW });
    const out = render(h(NowLanes, { data, canControl: true }));
    expect(out).toContain("شغّالة");
    expect(out).toContain("خلصت اليوم");
    expect(out).toContain("عرض الكل (7)");
    expect(out).toContain('data-tour="lanes"');
    expect(out).not.toMatch(/[{}]|push_|log_run|MCP|handoff/);
  });
});

describe("the board of the day", () => {
  it("a folded job is one line that opens; the lines have the clock, the name and the word", () => {
    const j = job("hourly", { schedule: "0 * * * *", name: "جولة الفريق" });
    const board = buildDayBoard({ jobs: [j], runs: [], bounds: workdayOf("2026-11-22"), now: NOW, names });
    const out = render(h(DayBoardView, { entries: board.entries, label: "جدول اليوم" }));
    expect(board.entries.some((e) => e.kind === "group")).toBe(true);
    expect(out).toContain("<details");
    expect(out).toContain("جولة الفريق");
    expect(out).toContain("موعد:");
  });

  it("an empty day says what it is for", () => {
    expect(render(h(DayBoardView, { entries: [], label: "x" }))).toContain("ما في مواعيد باليوم هاد");
  });

  it("what was done: 104 videos are one line that opens", () => {
    const items = Array.from({ length: 104 }, (_, i) => ({ at: `2026-11-22T18:${String(i % 60).padStart(2, "0")}:00.000Z`, actor: "claude", kind: "video" as const, text: `فيديو V${i} (حرير): انرفع لميتا` }));
    const out = render(h(DoneLines, { lines: collapseDayItems(items) }));
    expect(out).toContain("104 فيديو انرفعوا لميتا");
    expect(count(out, /<li/g)).toBe(1 + 104); // the one line and the 104 it stands for
    expect(render(h(DoneLines, { lines: [] }))).toContain("ما في شي تاني انعمل");
  });
});

describe("the list of everything", () => {
  it("each row has its number, its name, when in words and who, its kind; a person's task has the kind «لشخص»", () => {
    const groups = buildAll({
      jobs: [job("a", { number: 1, name: "جولة الليل", schedule: "35 0 * * *" })],
      last: new Map([["a", { status: "ok", nodeStates: {} }]]),
      tasks: [{ id: "t1", title: "ذكّر حدا", assignee: "claude", status: "new", dueAt: "2026-11-20T09:00:00.000Z", priority: "normal" }],
      names,
      now: NOW,
    });
    const out = render(h(AllList, { groups, canSwitch: false }));
    expect(out).toContain("جولة الليل");
    expect(out).toContain("كل يوم 12:35 بالليل");
    expect(out).toContain("متكررة");
    expect(out).toContain("لشخص");
    expect(out).toContain("خلصت");
  });

  it("a filter that matches nothing says so", () => {
    expect(render(h(AllList, { groups: [], canSwitch: false }))).toContain("ما في مهام بهالفلتر");
  });
});

describe("a report — never braces", () => {
  it("a report of the code is sentences and a table; the numbers have the owner's names; a link is https only; a text that looks like JSON but is not is folded as raw text", () => {
    const out = render(
      h(ReportView, {
        text: JSON.stringify({ total_usd: 120, daily_allocation: [{ product_code: "X", usd: 40 }], by: "code" }),
        metrics: { ads_paused: 3, unknown_thing: 2 },
        artifacts: [{ label: "تقرير", url: "https://example.com/r" }, { label: "رابط خطر", url: "javascript:alert(1)" }],
      }),
    );
    expect(out).toContain("total usd");
    expect(out).toContain("إعلانات موقوفة");
    expect(out).toContain("unknown thing"); // a key with no name is shown as it is
    expect(out).toContain('href="https://example.com/r"');
    expect(out).not.toContain("javascript:");
    expect(out).not.toMatch(/&quot;|\{"/);
    const raw = render(h(ReportView, { text: "{ ليس JSON", metrics: null, artifacts: [] }));
    expect(raw).toContain("نص خام");
    expect(raw).toContain("<details");
  });

  it("a plain text is a paragraph; nothing at all draws nothing", () => {
    expect(render(h(ReportView, { text: "خلصنا الجولة ✓", metrics: null, artifacts: [] }))).toContain("خلصنا الجولة ✓");
    expect(render(h(ReportView, { text: null, metrics: null, artifacts: [] }))).not.toContain("<section");
  });
});
