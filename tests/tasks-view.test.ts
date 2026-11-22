/**
 * «المهام» as data (v6 · P3, docs/rebuild-v6/02-screens.md §3): the lanes of «هلق», the board of the day (the working day is 06:00 → 06:00, a job with more than four moments folds into
 * one line), the list of everything, and the words of a run. All of it is built from stored rows by pure functions: the lamp and the word of a line are the run's own.
 */
import { describe, expect, it } from "vitest";
import {
  FOLD_OVER, actionsFor, boardHeadline, buildAll, buildDayBoard, buildNow, durationWords, foldBoard, isSuperseded, oneLine, sentenceOf, stateOfRun, stepTimeWords, stripOf, waitingOn, whoIs, whoOptions,
  type BoardRow, type ViewJob, type ViewRun, type ViewTask,
} from "@/core/tasks-view";
import { workdayBounds, workdayOf } from "@/core/timeline";

const NOW = new Date("2026-11-22T17:00:00.000Z"); // 20:00 Amman
const at = (hhmm: string, day = "2026-11-22") => new Date(`${day}T${hhmm}:00.000Z`).toISOString(); // UTC clock, the tests think in UTC and convert below
const graph = (ids: string[]) => {
  const nodes = [{ id: "start", type: "trigger" as const, label: "بداية" }, ...ids.map((id) => ({ id, type: "step" as const, label: `خطوة ${id}`, executor: "claude_mcp" as const }))];
  return { nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) };
};
const job = (key: string, over: Partial<ViewJob> = {}): ViewJob => ({ key, number: 1, name: `مهمة ${key}`, domain: "ads", kind: "recurring", schedule: null, scheduleText: null, runsAt: null, endsAt: null, enabled: true, graceMin: 15, assigneeKey: "claude", graph: graph(["a", "b", "c"]), ...over });
const run = (id: string, jobKey: string, status: string, over: Partial<ViewRun> = {}): ViewRun => ({ id, jobKey, status, trigger: "schedule", scheduledFor: null, startedAt: at("16:00"), heartbeatAt: null, finishedAt: null, endReason: null, summary: null, doneBy: null, nodeStates: {}, ...over });
const names = { claude: "Claude الرئيسي", muse: "ميوز" };

describe("one word for a run", () => {
  it("what a waiting run waits on: a decision (a step on «approval») or a step that needs somebody", () => {
    expect(waitingOn(run("r", "j", "running"))).toBeNull();
    expect(waitingOn(run("r", "j", "waiting", { nodeStates: { a: { status: "approval", at: at("16:01") } } }))).toBe("approval");
    expect(waitingOn(run("r", "j", "waiting", { nodeStates: { a: { status: "failed", at: at("16:01") } } }))).toBe("step");
  });

  it("the state word comes from the dictionary: every status has exactly one", () => {
    const word = (status: string, nodeStates = {}) => stateOfRun({ status, nodeStates });
    expect(word("ok")).toBe("done");
    expect(word("running")).toBe("run");
    expect(word("failed")).toBe("fail");
    expect(word("missed")).toBe("missed");
    expect(word("lost")).toBe("lost");
    expect(word("skipped")).toBe("skipped");
    expect(word("queued")).toBe("queued");
    expect(word("waiting", { a: { status: "approval", at: "x" } })).toBe("approval");
    expect(word("waiting", { a: { status: "failed", at: "x" } })).toBe("stuck");
  });

  it("the rope is the run's own states in the order the steps run — never invented; a step the agent did not report is off", () => {
    const j = job("j");
    const strip = stripOf(j, run("r", "j", "running", { nodeStates: { a: { status: "done", at: "x" }, b: { status: "running", at: "x" } } }));
    expect(strip.map((s) => s.lamp)).toEqual(["done", "run", "off"]);
    expect(strip.map((s) => s.id)).toEqual(["a", "b", "c"]);
    // a step the site inferred carries the mark (the strip draws it green without a halo)
    const inferred = stripOf(j, run("r", "j", "ok", { nodeStates: { a: { status: "done", at: "x", inferred: true } } }));
    expect(inferred[0]).toMatchObject({ lamp: "done", inferred: true });
    expect(stripOf(j, null).map((s) => s.lamp)).toEqual(["off", "off", "off"]);
  });

  it("the sentence says who a queued run waits for, by name", () => {
    const s = sentenceOf(job("j"), run("r", "j", "queued", { scheduledFor: at("16:00"), assignee: "claude" }), names, NOW);
    expect(s).toMatch(/^بانتظار Claude الرئيسي/);
    expect(whoIs("muse", names)).toBe("ميوز");
    expect(whoIs("site", {})).toBe("الموقع");
    expect(whoIs(null, names)).toBe("بلا مسؤول");
  });

  it("times in words: a duration and «من 00:35 لـ 00:37 (دقيقتين)»", () => {
    expect(durationWords("2026-11-22T00:35:00Z", "2026-11-22T00:37:00Z")).toBe("دقيقتين");
    expect(durationWords("2026-11-22T00:35:00Z", "2026-11-22T00:35:20Z")).toBe("أقل من دقيقة");
    expect(durationWords("2026-11-22T00:00:00Z", "2026-11-22T00:12:00Z")).toBe("12 دقيقة");
    expect(durationWords("2026-11-22T00:00:00Z", "2026-11-22T01:10:00Z")).toBe("ساعة و10 دقايق");
    expect(durationWords("2026-11-22T00:00:00Z", null)).toBeNull();
    // 00:35 UTC is 03:35 in Amman
    expect(stepTimeWords("2026-11-22T00:35:00Z", "2026-11-22T00:37:00Z")).toBe("من 03:35 لـ 03:37 (دقيقتين)");
    expect(stepTimeWords("2026-11-22T00:35:00Z", null)).toBe("من 03:35");
    expect(stepTimeWords(undefined, undefined)).toBeNull();
  });

  it("a result in one line", () => {
    expect(oneLine("  أول سطر\nتاني سطر ")).toBe("أول سطر");
    expect(oneLine("x".repeat(200))!.length).toBe(90);
    expect(oneLine(null)).toBeNull();
    expect(oneLine("   ")).toBeNull();
  });
});

describe("the buttons of a state", () => {
  it("one primary at most; a stopped run offers retry and skip, a missed slot offers run-now and dismiss, a decision opens the run", () => {
    expect(actionsFor("fail").map((a) => a.key)).toEqual(["retry", "skip", "open"]);
    expect(actionsFor("lost").map((a) => a.key)).toEqual(["retry", "skip", "open"]);
    expect(actionsFor("stuck").map((a) => a.key)).toEqual(["retry", "skip", "open"]);
    expect(actionsFor("approval").map((a) => a.key)).toEqual(["open"]);
    expect(actionsFor("queued").map((a) => a.key)).toEqual(["open", "cancel"]);
    expect(actionsFor("missed").map((a) => a.key)).toEqual(["run_now", "dismiss"]);
    expect(actionsFor("done")).toEqual([]);
    expect(actionsFor("next")).toEqual([]);
    for (const s of ["fail", "approval", "queued", "missed", "stuck", "run", "done", "lost"] as const) expect(actionsFor(s).filter((a) => a.variant === "primary").length).toBeLessThanOrEqual(1);
  });
});

describe("«هلق» — the lanes", () => {
  const jobs = [job("night", { number: 1 }), job("team", { number: 2, name: "جولة الفريق" }), job("stock", { number: 3, name: "تنبيهات المخزون" })];

  it("a lane that is empty is not drawn", () => {
    const d = buildNow({ jobs, runs: [], tasks: [], names, now: NOW });
    expect(d.lanes.filter((l) => l.key !== "upcoming")).toEqual([]);
    expect(d.needs).toBe(0);
  });

  it("waiting, a request nobody took after its grace, and a failure that nothing later answered are all «واقفة — بدها حدا»", () => {
    const runs = [
      run("w", "night", "waiting", { nodeStates: { a: { status: "approval", at: at("16:30") } } }),
      run("q-late", "team", "queued", { scheduledFor: at("16:00"), assignee: "claude" }), // 60 minutes, the grace is 15
      run("f", "stock", "failed", { finishedAt: at("15:00"), startedAt: at("14:50") }),
    ];
    const d = buildNow({ jobs, runs, tasks: [], names, now: NOW });
    const stuck = d.lanes.find((l) => l.key === "stuck")!;
    expect(stuck.total).toBe(3);
    expect(stuck.cards.map((c) => c.state).sort()).toEqual(["approval", "fail", "queued"].sort());
    expect(d.needs).toBe(3);
    // each card carries its own rope and its buttons
    const failed = stuck.cards.find((c) => c.state === "fail")!;
    expect(failed.actions.map((a) => a.key)).toContain("retry");
    expect(failed.steps).toHaveLength(3);
  });

  it("a request just made, still inside its grace, is in «شغّالة» — it waits, nothing is wrong yet", () => {
    const d = buildNow({ jobs, runs: [run("q", "team", "queued", { scheduledFor: at("16:55"), assignee: "claude" })], tasks: [], names, now: NOW });
    expect(d.lanes.map((l) => l.key)).toContain("running");
    expect(d.lanes.find((l) => l.key === "stuck")).toBeUndefined();
    expect(d.lanes.find((l) => l.key === "running")!.cards[0]!.state).toBe("queued");
  });

  it("a failure that a later successful run answered is old news; one older than 24 hours is not shown", () => {
    const old = run("f1", "stock", "failed", { startedAt: at("10:00"), finishedAt: at("10:05") });
    const fixed = run("ok1", "stock", "ok", { startedAt: at("12:00"), finishedAt: at("12:05") });
    expect(isSuperseded(old, [old, fixed])).toBe(true);
    const d = buildNow({ jobs, runs: [old, fixed], tasks: [], names, now: NOW });
    expect(d.lanes.find((l) => l.key === "stuck")).toBeUndefined();
    const ancient = run("f0", "night", "failed", { startedAt: "2026-11-20T10:00:00.000Z", finishedAt: "2026-11-20T10:05:00.000Z" });
    expect(buildNow({ jobs, runs: [ancient], tasks: [], names, now: NOW }).lanes.find((l) => l.key === "stuck")).toBeUndefined();
  });

  it("missed slots of today: ONE card a job (the latest), with how many came before it", () => {
    const m1 = run("m1", "team", "missed", { scheduledFor: at("08:00"), startedAt: at("08:20") });
    const m2 = run("m2", "team", "missed", { scheduledFor: at("10:00"), startedAt: at("10:20") });
    const d = buildNow({ jobs, runs: [m1, m2], tasks: [], names, now: NOW });
    const lane = d.lanes.find((l) => l.key === "missed")!;
    expect(lane.cards).toHaveLength(1);
    expect(lane.cards[0]).toMatchObject({ runId: "m2", more: 1, state: "missed" });
    expect(lane.cards[0]!.actions.map((a) => a.key)).toEqual(["run_now", "dismiss"]);
    expect(d.needs).toBe(1);
  });

  it("the team's tasks: only the late ones and the ones due today, late first", () => {
    const tasks: ViewTask[] = [
      { id: "t1", title: "بعد أسبوع", assignee: "muse", status: "new", dueAt: "2026-11-30T09:00:00.000Z", priority: "normal" },
      { id: "t2", title: "اليوم", assignee: "muse", status: "doing", dueAt: "2026-11-22T09:00:00.000Z", priority: "normal" },
      { id: "t3", title: "متأخرة", assignee: "claude", status: "new", dueAt: "2026-11-20T09:00:00.000Z", priority: "normal" },
      { id: "t4", title: "خلصت", assignee: "muse", status: "done", dueAt: "2026-11-20T09:00:00.000Z", priority: "normal" },
    ];
    const lane = buildNow({ jobs, runs: [], tasks, names, now: NOW }).lanes.find((l) => l.key === "team")!;
    expect(lane.tasks.map((t) => [t.title, t.due])).toEqual([["متأخرة", "late"], ["اليوم", "today"]]);
    expect(lane.tasks[0]!.who).toBe("Claude الرئيسي");
  });

  it("done today: the last 5 only, with how many in all", () => {
    const done = Array.from({ length: 8 }, (_, i) => run(`d${i}`, "night", "ok", { startedAt: at(`1${i}:00`), finishedAt: at(`1${i}:05`), summary: `نتيجة ${i}` }));
    const lane = buildNow({ jobs, runs: done, tasks: [], names, now: NOW }).lanes.find((l) => l.key === "done")!;
    expect(lane.total).toBe(8);
    expect(lane.lines).toHaveLength(5);
    expect(lane.lines[0]!.line).toBe("نتيجة 7");
  });

  it("the first six moments still to come", () => {
    const hourly = job("hourly", { schedule: "0 * * * *" });
    const lane = buildNow({ jobs: [hourly], runs: [], tasks: [], names, now: new Date("2026-11-22T05:30:00.000Z") }).lanes.find((l) => l.key === "upcoming")!;
    expect(lane.lines).toHaveLength(6);
    expect(lane.total).toBeGreaterThan(6);
    expect(lane.lines[0]!.time).toBe("09:00"); // 06:00 UTC
  });
});

describe("«جدول اليوم» — the working day is 06:00 → 06:00", () => {
  it("the day a night round belongs to: at 02:00 Amman the working day is still yesterday's", () => {
    const night = new Date("2026-11-22T23:00:00.000Z"); // 02:00 on the 23rd, Amman
    expect(workdayBounds(night).key).toBe("2026-11-22");
    expect(workdayOf("2026-11-22").from.toISOString()).toBe("2026-11-22T03:00:00.000Z"); // 06:00 Amman
    expect(workdayOf("2026-11-22").to.toISOString()).toBe("2026-11-23T03:00:00.000Z");
  });

  it("a slot at 00:35 belongs to the evening before, not to the next calendar day", () => {
    const j = job("nr", { schedule: "35 0 * * *" });
    const eve = buildDayBoard({ jobs: [j], runs: [], bounds: workdayOf("2026-11-22"), now: new Date("2026-11-22T12:00:00.000Z"), names });
    expect(eve.rows.map((r) => r.time)).toEqual(["00:35"]); // 00:35 on the 23rd, inside the 22nd's working day
    const nextDay = buildDayBoard({ jobs: [j], runs: [], bounds: workdayOf("2026-11-23"), now: new Date("2026-11-22T12:00:00.000Z"), names });
    expect(nextDay.rows).toHaveLength(1);
    expect(nextDay.rows[0]!.at).not.toBe(eve.rows[0]!.at);
  });

  it("every moment has one word: done, running, stuck, missed, next — and the headline counts them with the dictionary's words", () => {
    const j = job("every", { schedule: "0 9,10,11,12 * * *", name: "فحص" });
    const day = workdayOf("2026-11-22");
    const now = new Date("2026-11-22T08:30:00.000Z"); // 11:30 Amman: the 9:00, 10:00 and 11:00 moments are past, 12:00 is still to come
    const runs = [
      run("r9", "every", "ok", { scheduledFor: "2026-11-22T06:00:00.000Z", startedAt: "2026-11-22T06:01:00.000Z", finishedAt: "2026-11-22T06:03:00.000Z", summary: "تمام" }),
      run("r10", "every", "missed", { scheduledFor: "2026-11-22T07:00:00.000Z", startedAt: "2026-11-22T07:20:00.000Z", endReason: "missed" }),
      run("r11", "every", "waiting", { scheduledFor: "2026-11-22T08:00:00.000Z", startedAt: "2026-11-22T08:01:00.000Z", nodeStates: { a: { status: "failed", at: "x" } } }),
    ];
    const b = buildDayBoard({ jobs: [j], runs, bounds: day, now, names });
    expect(b.rows.map((r) => r.state)).toEqual(["done", "missed", "stuck", "next"]);
    expect(b.counts).toMatchObject({ done: 1, missed: 1, stuck: 1, next: 1 });
    expect(b.headline).toBe("خلصت 1 · فاتت 1 · واقفة 1 · جاية 1");
    expect(b.rows[0]!.line).toBe("تمام");
    expect(b.rows[1]!.line).toBe("ما وصل أي تسجيل");
  });

  it("the counter line uses the words of the dictionary, in a fixed order, and leaves out what is zero", () => {
    expect(boardHeadline({ next: 4, done: 6, missed: 1, run: 1 })).toBe("خلصت 6 · فاتت 1 · شغّالة 1 · جاية 4");
    expect(boardHeadline({})).toBe("");
  });

  it("a job with more than four moments folds into ONE line with its counts; four or fewer stay as they are", () => {
    const row = (jobKey: string, i: number, state: BoardRow["state"]): BoardRow => ({ id: `${jobKey}${i}`, at: at(`0${i}:00`), time: `0${i}:00`, jobKey, number: 1, name: jobKey, who: "x", state, line: null, runId: null, href: "/", past: true });
    const many = [1, 2, 3, 4, 5].map((i) => row("team", i, i < 4 ? "done" : "next"));
    const few = [1, 2, 3, 4].map((i) => row("stock", i, "done"));
    const entries = foldBoard([...many, ...few].sort((a, b) => a.at.localeCompare(b.at) || a.jobKey.localeCompare(b.jobKey)));
    const groups = entries.filter((e) => e.kind === "group");
    expect(FOLD_OVER).toBe(4);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ jobKey: "team", total: 5, summary: "خلصت 3 · جاية 2" });
    expect(entries.filter((e) => e.kind === "row")).toHaveLength(4);
  });

  it("filters: by who carries the job, by area", () => {
    const a = job("a", { schedule: "0 9 * * *", assigneeKey: "claude", domain: "ads" });
    const b = job("b", { schedule: "0 10 * * *", assigneeKey: "muse", domain: "ops" });
    const base = { jobs: [a, b], runs: [], bounds: workdayOf("2026-11-22"), now: NOW, names };
    expect(buildDayBoard({ ...base, filter: { who: "muse" } }).rows.map((r) => r.jobKey)).toEqual(["b"]);
    expect(buildDayBoard({ ...base, filter: { domain: "ads" } }).rows.map((r) => r.jobKey)).toEqual(["a"]);
    expect(buildDayBoard(base).rows).toHaveLength(2);
  });

  it("a job that is switched off has no moments on the board", () => {
    expect(buildDayBoard({ jobs: [job("off", { schedule: "0 9 * * *", enabled: false })], runs: [], bounds: workdayOf("2026-11-22"), now: NOW, names }).rows).toEqual([]);
  });
});

describe("«كل المهام» — one list", () => {
  const jobs = [job("ads1", { number: 2, name: "ب", domain: "ads", kind: "recurring" }), job("ads0", { number: 1, name: "أ", domain: "ads", kind: "once", assigneeKey: "muse" }), job("ops1", { number: 3, name: "ج", domain: "ops", kind: "manual", enabled: false })];
  const tasks: ViewTask[] = [{ id: "t1", title: "ذكّر حدا", assignee: "muse", status: "new", dueAt: "2026-11-20T09:00:00.000Z", priority: "normal" }, { id: "t2", title: "خلصت", assignee: "muse", status: "done", dueAt: null, priority: "normal" }];
  const base = { jobs, last: new Map(), tasks, names, now: NOW };

  it("two groups; the jobs in the order of their numbers; the people's tasks join «فريق وتشغيل» with the kind «لشخص»; a finished task is not listed", () => {
    const g = buildAll(base);
    expect(g.map((x) => x.domain)).toEqual(["ads", "ops"]);
    expect(g[0]!.rows.map((r) => r.number)).toEqual([1, 2]);
    expect(g[1]!.rows.map((r) => [r.kindLabel, r.type])).toEqual([["عند الطلب", "job"], ["لشخص", "person"]]);
    expect(g[1]!.rows.find((r) => r.type === "person")).toMatchObject({ lamp: "fail", name: "ذكّر حدا" });
  });

  it("the filters: the kind and the person", () => {
    expect(buildAll({ ...base, filter: { kind: "person" } }).flatMap((g) => g.rows).map((r) => r.type)).toEqual(["person"]);
    expect(buildAll({ ...base, filter: { who: "muse" } }).flatMap((g) => g.rows).map((r) => r.name)).toEqual(["أ", "ذكّر حدا"]);
    expect(buildAll({ ...base, filter: { kind: "once" } }).flatMap((g) => g.rows).map((r) => r.number)).toEqual([1]);
  });

  it("the lamp of a job is its last run's, with the word beside it; a job that never ran has none", () => {
    const last = new Map([["ads1", { status: "failed", nodeStates: {} }]]);
    const rows = buildAll({ ...base, last }).flatMap((g) => g.rows);
    expect(rows.find((r) => r.key === "ads1")).toMatchObject({ lamp: "fail", word: "fail" });
    expect(rows.find((r) => r.key === "ads0")).toMatchObject({ lamp: "off", word: null });
  });

  it("the people who appear, for the filter chips", () => {
    expect(whoOptions(jobs, tasks, names)).toEqual([{ key: "claude", label: "Claude الرئيسي" }, { key: "muse", label: "ميوز" }]);
  });
});
