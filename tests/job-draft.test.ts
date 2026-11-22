/**
 * The job draft (v6 · P4-1, docs/rebuild-v6/02-screens.md §3.7–§3.8): what «مهمة جديدة» builds before it is saved. The cron every «when» means (on the Amman clock), a time that
 * has passed is refused, the draft becomes a job and the job's drawing reads back as the same draft, a drawing that is not a line is said so, and every move of the blocks.
 */
import { describe, expect, it } from "vitest";
import { nextRuns, runsBetween } from "@/core/cron";
import { ammanInstant } from "@/core/dates";
import {
  JobDraftSchema,
  defaultWhen,
  endOfDay,
  joinInstant,
  splitInstant,
  validateSteps,
  MAX_STEPS,
  MAX_STEP_TEXT,
  NOTIFY_PRESETS,
  addStep,
  draftGraph,
  draftSentence,
  draftToJob,
  draftToTask,
  emptyDraft,
  graphToDraft,
  graphToSteps,
  isPersonTask,
  moveItem,
  moveStep,
  nodeToStep,
  normalizeDraft,
  notifyWords,
  presetOf,
  removeItem,
  removeStep,
  setElse,
  settleLayout,
  setStepText,
  suggestName,
  toCron,
  validateDraft,
  whenWords,
  type DraftStep,
  type JobDraft,
  type When,
} from "@/core/job-draft";
import { SEED_WORKFLOWS, GraphSchema, type WfGraph } from "@/core/workflow";
import { graphDiff, isChanged } from "@/core/workflow-edit";

// Sunday 22/11/2026, 13:00 on the Amman clock (UTC+3)
const NOW = new Date("2026-11-22T10:00:00.000Z");
const draft = (over: Partial<JobDraft> = {}): JobDraft => ({
  name: "فحص المخزون",
  domain: "ops",
  assigneeKey: "claude",
  when: { kind: "daily", time: "09:30" },
  steps: [
    { verb: "read", text: "اقرا المخزون" },
    { verb: "decide", text: "إذا المخزون قليل" },
    { verb: "tell", text: "ابعتلي تنبيه" },
  ],
  notifyOn: ["stuck", "missed", "failed"],
  ...over,
});
const ok = (d: JobDraft, now = NOW) => validateDraft(d, now);
const why = (d: JobDraft, now = NOW) => {
  const r = validateDraft(d, now);
  return r.ok ? null : r.field;
};

describe("every «when» is a cron on the Amman clock", () => {
  it("every day: the minute and the hour, with no leading zero", () => {
    expect(toCron({ kind: "daily", time: "09:30" }, NOW)).toBe("30 9 * * *");
    expect(toCron({ kind: "daily", time: "00:05" }, NOW)).toBe("5 0 * * *");
    expect(toCron({ kind: "daily", time: "23:59" }, NOW)).toBe("59 23 * * *");
  });

  it("every hour inside a span: the hours of the span, stepped; the last hour is one that still fits before the end", () => {
    expect(toCron({ kind: "hourly", from: "10:00", to: "22:00", everyHours: 2 }, NOW)).toBe("0 10-22/2 * * *");
    expect(toCron({ kind: "hourly", from: "10:00", to: "22:00", everyHours: 1 }, NOW)).toBe("0 10-22 * * *");
    expect(toCron({ kind: "hourly", from: "10:30", to: "22:00", everyHours: 2 }, NOW)).toBe("30 10-20/2 * * *");
    expect(toCron({ kind: "hourly", from: "09:30", to: "21:30", everyHours: 4 }, NOW)).toBe("30 9-21/4 * * *");
    expect(toCron({ kind: "hourly", from: "10:00", to: "10:00", everyHours: 3 }, NOW)).toBe("0 10 * * *");
    // a span that goes backwards has no cron
    expect(toCron({ kind: "hourly", from: "22:00", to: "10:00", everyHours: 2 }, NOW)).toBeNull();
  });

  it("every week: the days in order (0 is Sunday), each at the time", () => {
    expect(toCron({ kind: "weekly", days: [4], time: "11:20" }, NOW)).toBe("20 11 * * 4");
    expect(toCron({ kind: "weekly", days: [4, 0, 4, 2], time: "08:00" }, NOW)).toBe("0 8 * * 0,2,4");
    expect(toCron({ kind: "weekly", days: [], time: "08:00" }, NOW)).toBeNull();
  });

  it("for a period: every N hours counted from a few minutes after saving, and the same hours come round every day", () => {
    // 13:00 + 5 minutes = 13:05 on the Amman clock
    expect(toCron({ kind: "window", everyHours: 2, until: "2026-11-22T20:59:00.000Z" }, NOW)).toBe("5 1,3,5,7,9,11,13,15,17,19,21,23 * * *");
    expect(toCron({ kind: "window", everyHours: 6, until: "2026-11-22T20:59:00.000Z" }, NOW)).toBe("5 1,7,13,19 * * *");
    expect(toCron({ kind: "window", everyHours: 1, until: "2026-11-22T20:59:00.000Z" }, NOW)).toBe("5 * * * *");
  });

  it("now and once are a moment, not a cron", () => {
    expect(toCron({ kind: "now" }, NOW)).toBeNull();
    expect(toCron({ kind: "once", date: "2026-11-25", time: "09:00" }, NOW)).toBeNull();
  });

  it("the cron fires on the Amman clock: 09:30 there is 06:30 UTC; Thursday 11:20 is the next Thursday; the hourly span stops at its end", () => {
    const next = (w: When) => nextRuns(toCron(w, NOW)!, NOW, 3).map((d) => d.toISOString());
    expect(next({ kind: "daily", time: "09:30" })).toEqual(["2026-11-23T06:30:00.000Z", "2026-11-24T06:30:00.000Z", "2026-11-25T06:30:00.000Z"]);
    expect(next({ kind: "weekly", days: [4], time: "11:20" })[0]).toBe("2026-11-26T08:20:00.000Z");
    // 10:00 to 22:00 every 2 hours: seven runs a day, the last at 22:00 Amman (19:00 UTC)
    const day = runsBetween(toCron({ kind: "hourly", from: "10:00", to: "22:00", everyHours: 2 }, NOW)!, new Date("2026-11-23T00:00:00.000Z"), new Date("2026-11-24T00:00:00.000Z"));
    expect(day.map((d) => d.toISOString().slice(11, 16))).toEqual(["07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00"]);
    // the window's first run is five minutes after the draft is saved: 13:05 on the Amman clock, and two hours later the next
    expect(next({ kind: "window", everyHours: 2, until: "2026-11-22T20:59:00.000Z" }).slice(0, 2)).toEqual(["2026-11-22T10:05:00.000Z", "2026-11-22T12:05:00.000Z"]);
  });
});

describe("validateDraft", () => {
  it("a sound draft passes", () => {
    expect(ok(draft())).toEqual({ ok: true });
  });

  it("a one-time moment in the past is refused, today earlier than now too; a coming one passes", () => {
    expect(why(draft({ when: { kind: "once", date: "2026-11-21", time: "09:00" } }))).toBe("when.date");
    expect(why(draft({ when: { kind: "once", date: "2026-11-22", time: "12:59" } }))).toBe("when.date");
    expect(ok(draft({ when: { kind: "once", date: "2026-11-22", time: "13:01" } }))).toEqual({ ok: true });
    expect(ok(draft({ when: { kind: "once", date: "2026-11-23", time: "00:00" } }))).toEqual({ ok: true });
    expect(why(draft({ when: { kind: "once", date: "2026-13-40", time: "09:00" } }))).toBe("when.date");
    expect(why(draft({ when: { kind: "once", date: "2026-12-01", time: "9:00" } }))).toBe("when.time");
  });

  it("the message says what to do, in the owner's words", () => {
    const r = validateDraft(draft({ when: { kind: "once", date: "2026-11-21", time: "09:00" } }), NOW);
    expect(r).toMatchObject({ ok: false, message: "هالموعد فات — اختار وقت جاي" });
  });

  it("the other whens: a time that is not a time, an empty day list, a span that goes backwards, a period that has ended", () => {
    expect(why(draft({ when: { kind: "daily", time: "25:00" } }))).toBe("when.time");
    expect(why(draft({ when: { kind: "weekly", days: [], time: "09:00" } }))).toBe("when.days");
    expect(why(draft({ when: { kind: "weekly", days: [7], time: "09:00" } }))).toBe("when.days");
    expect(why(draft({ when: { kind: "hourly", from: "22:00", to: "10:00", everyHours: 2 } }))).toBe("when.to");
    expect(why(draft({ when: { kind: "hourly", from: "10:00", to: "22:00", everyHours: 5 as 2 } }))).toBe("when.everyHours");
    expect(why(draft({ when: { kind: "window", everyHours: 2, until: "2026-11-22T09:00:00.000Z" } }))).toBe("when.until");
    expect(why(draft({ when: { kind: "window", everyHours: 2, until: "no" } }))).toBe("when.until");
    expect(ok(draft({ when: { kind: "window", everyHours: 2, until: "2026-11-22T20:59:00.000Z" } }))).toEqual({ ok: true });
    expect(ok(draft({ when: { kind: "now" } }))).toEqual({ ok: true });
  });

  it("a name, a doer, and at least one step with a text", () => {
    expect(why(draft({ name: "  " }))).toBe("name");
    expect(why(draft({ assigneeKey: "" }))).toBe("assigneeKey");
    expect(why(draft({ assigneeKey: "Sara Q" }))).toBe("assigneeKey");
    expect(why(draft({ steps: [] }))).toBe("steps");
    expect(why(draft({ steps: [{ verb: "read", text: "  " }] }))).toBe("steps[0].text");
    expect(why(draft({ steps: [{ verb: "read", text: "x".repeat(MAX_STEP_TEXT + 1) }] }))).toBe("steps[0].text");
    expect(why(draft({ steps: Array.from({ length: MAX_STEPS + 1 }, () => ({ verb: "read" as const, text: "a" })) }))).toBe("steps");
  });

  it("the condition's «no»: only on «قرّر», only to a later step that is not the next one, or to the end", () => {
    const steps = (e: DraftStep["elseGoto"]): DraftStep[] => [
      { verb: "read", text: "a" },
      { verb: "decide", text: "b", elseGoto: e },
      { verb: "do", text: "c" },
      { verb: "tell", text: "d" },
    ];
    expect(ok(draft({ steps: steps(3) }))).toEqual({ ok: true });
    expect(ok(draft({ steps: steps("end") }))).toEqual({ ok: true });
    expect(ok(draft({ steps: steps(undefined) }))).toEqual({ ok: true });
    // the next step is where «yes» goes: «no» there too would be no choice at all
    expect(why(draft({ steps: steps(2) }))).toBe("steps[1].elseGoto");
    // back to the step itself, or before it
    expect(why(draft({ steps: steps(1) }))).toBe("steps[1].elseGoto");
    expect(why(draft({ steps: steps(0) }))).toBe("steps[1].elseGoto");
    // past the end
    expect(why(draft({ steps: steps(4) }))).toBe("steps[1].elseGoto");
    // a step that is not a condition has no «no»
    expect(why(draft({ steps: [{ verb: "read", text: "a", elseGoto: 2 }, { verb: "read", text: "b" }, { verb: "read", text: "c" }] }))).toBe("steps[0].elseGoto");
  });

  it("the site by itself carries out recipes only: «الموقع» with free steps is refused, a recipe needs «الموقع»", () => {
    expect(why(draft({ assigneeKey: "site" }))).toBe("assigneeKey");
    expect(ok(draft({ assigneeKey: "site", steps: [], recipe: { name: "stock_alert", params: {} } }))).toEqual({ ok: true });
    expect(why(draft({ assigneeKey: "claude", recipe: { name: "stock_alert", params: {} } }))).toBe("recipe");
  });

  it("the events that ring are among the four", () => {
    expect(why(draft({ notifyOn: ["bell" as "done"] }))).toBe("notifyOn");
    expect(ok(draft({ notifyOn: [] }))).toEqual({ ok: true });
  });

  it("the shape that comes from outside lets nothing else in", () => {
    expect(JobDraftSchema.safeParse(draft()).success).toBe(true);
    expect(JobDraftSchema.safeParse({ ...draft(), extra: 1 }).success).toBe(false);
    expect(JobDraftSchema.safeParse({ ...draft(), when: { kind: "daily", time: "09:30", extra: 1 } }).success).toBe(false);
    expect(JobDraftSchema.safeParse({ ...draft(), when: { kind: "sometimes" } }).success).toBe(false);
    expect(JobDraftSchema.safeParse({ ...draft(), steps: [{ verb: "fly", text: "x" }] }).success).toBe(false);
    expect(JobDraftSchema.safeParse({ ...draft(), notifyOn: ["sms"] }).success).toBe(false);
  });
});

describe("draftToJob", () => {
  it("every day: a recurring job with its cron, the words that say it, and the site as the clock", () => {
    const j = draftToJob(draft(), NOW);
    expect(j).toMatchObject({ kind: "recurring", schedule: "30 9 * * *", scheduleText: "كل يوم 09:30", runsAt: null, endsAt: null, wake: "site", assigneeKey: "claude", executor: "claude_mcp", runNow: false, recipe: null, domain: "ops", name: "فحص المخزون" });
    expect(j.notifyOn).toEqual(["stuck", "missed", "failed"]);
  });

  it("a moment: a one-time job at that moment on the Amman clock", () => {
    const j = draftToJob(draft({ when: { kind: "once", date: "2026-11-25", time: "09:00" } }), NOW);
    expect(j).toMatchObject({ kind: "once", schedule: null, runNow: false });
    expect(j.runsAt?.toISOString()).toBe("2026-11-25T06:00:00.000Z");
    expect(j.runsAt).toEqual(ammanInstant("2026-11-25", "09:00"));
  });

  it("now: a one-time job whose moment is this one, and a request to run it goes out at once", () => {
    const j = draftToJob(draft({ when: { kind: "now" } }), NOW);
    expect(j).toMatchObject({ kind: "once", schedule: null, runNow: true, scheduleText: "هلق" });
    expect(j.runsAt?.toISOString()).toBe(NOW.toISOString());
  });

  it("for a period: a window with its end, its cron counted from saving", () => {
    const until = "2026-11-22T20:59:00.000Z";
    const j = draftToJob(draft({ when: { kind: "window", everyHours: 2, until } }), NOW);
    expect(j).toMatchObject({ kind: "window", schedule: "5 1,3,5,7,9,11,13,15,17,19,21,23 * * *", runsAt: null });
    expect(j.endsAt?.toISOString()).toBe(until);
    expect(j.scheduleText).toBe("كل ساعتين لحد 2026-11-22 23:59");
  });

  it("every hour and every week", () => {
    expect(draftToJob(draft({ when: { kind: "hourly", from: "10:00", to: "22:00", everyHours: 2 } }), NOW)).toMatchObject({ kind: "recurring", schedule: "0 10-22/2 * * *", scheduleText: "كل ساعتين من 10:00 لـ22:00" });
    expect(draftToJob(draft({ when: { kind: "weekly", days: [4, 0], time: "11:20" } }), NOW)).toMatchObject({ kind: "recurring", schedule: "20 11 * * 0,4", scheduleText: "كل الأحد والخميس 11:20" });
  });

  it("the drawing is valid for the schema, starts with a trigger and goes in a line; ids are s1…sn", () => {
    const j = draftToJob(draft(), NOW);
    expect(GraphSchema.safeParse(j.graph).success).toBe(true);
    expect(j.graph.nodes.map((n) => [n.id, n.type])).toEqual([["start", "trigger"], ["s1", "step"], ["s2", "condition"], ["s3", "notify"]]);
    expect(j.graph.nodes[0]!.label).toBe("كل يوم 09:30");
    expect(j.graph.edges).toEqual([{ from: "start", to: "s1" }, { from: "s1", to: "s2" }, { from: "s2", to: "s3", label: "نعم" }]);
  });

  it("the condition: «نعم» to the next step, «لا» to its `elseGoto` (the default: the end — no line)", () => {
    const steps: DraftStep[] = [
      { verb: "read", text: "a" },
      { verb: "decide", text: "b", elseGoto: 3 },
      { verb: "do", text: "c" },
      { verb: "tell", text: "d" },
    ];
    const g = draftToJob(draft({ steps }), NOW).graph;
    expect(g.edges.filter((e) => e.from === "s2")).toEqual([{ from: "s2", to: "s3", label: "نعم" }, { from: "s2", to: "s4", label: "لا" }]);
    const end = draftToJob(draft({ steps: steps.map((s) => (s.verb === "decide" ? { ...s, elseGoto: "end" as const } : s)) }), NOW).graph;
    expect(end.edges.filter((e) => e.from === "s2")).toEqual([{ from: "s2", to: "s3", label: "نعم" }]);
  });

  it("the verb decides the kind of node and its badge: reading is free, doing runs inside the rules, a gate needs the owner's yes", () => {
    const steps: DraftStep[] = [
      { verb: "read", text: "a" },
      { verb: "compare", text: "b" },
      { verb: "do", text: "c" },
      { verb: "ask", text: "d" },
      { verb: "wait_me", text: "e" },
      { verb: "tell", text: "f" },
    ];
    const j = draftToJob(draft({ steps }), NOW);
    const [, ...s] = j.graph.nodes;
    expect(s.map((n) => [n.type, n.permission])).toEqual([["step", "green"], ["step", "green"], ["step", "yellow"], ["step", "green"], ["approval", "red"], ["notify", "green"]]);
    expect(s[3]!.executor).toBe("person");
    expect(s[0]!.executor).toBe("claude_mcp");
    // the job carries the strictest badge of its steps
    expect(j.permission).toBe("red");
    expect(draftToJob(draft(), NOW).permission).toBe("green");
  });

  it("who does it decides the executor: Claude, the two other agents, the site, a person by the directory", () => {
    const exec = (k: string, kind?: "agent" | "person") => draftToJob(draft({ assigneeKey: k }), NOW, { kind }).executor;
    expect(exec("claude")).toBe("claude_mcp");
    expect(exec("claude_ads")).toBe("claude_mcp");
    expect(exec("hermes")).toBe("hermes");
    expect(exec("muse")).toBe("muse");
    expect(exec("member1", "person")).toBe("person");
    expect(exec("member1")).toBe("person");
    expect(exec("newbot", "agent")).toBe("claude_mcp");
  });

  it("a recipe is carried out by the site itself", () => {
    const j = draftToJob(draft({ assigneeKey: "site", steps: [], recipe: { name: "stock_alert", params: { days: 7 } } }), NOW);
    expect(j).toMatchObject({ wake: "site_run", recipe: "stock_alert", recipeParams: { days: 7 }, executor: "system" });
  });

  it("a draft that is not sound is not turned into a job that looks fine: it throws", () => {
    expect(() => draftToJob(draft({ when: { kind: "once", date: "2026-11-21", time: "09:00" } }), NOW)).toThrow(/when\.date/);
    expect(() => draftToJob(draft({ steps: [] }), NOW)).toThrow(/steps/);
  });

  it("the texts are trimmed and the name too", () => {
    const j = draftToJob(draft({ name: "  فحص  ", steps: [{ verb: "read", text: "  المخزون  " }] }), NOW);
    expect(j.name).toBe("فحص");
    expect(j.graph.nodes[1]!.label).toBe("اقرا: المخزون");
  });
});

describe("the way back: the drawing of a draft reads as that draft", () => {
  const { assigneeKey, domain, name, notifyOn, when } = draft();
  const rest = { assigneeKey, domain, name, notifyOn, when };
  const back = (d: JobDraft) => {
    const r = graphToDraft(draftToJob(d, NOW).graph, { assigneeKey: d.assigneeKey, domain: d.domain, name: d.name, notifyOn: d.notifyOn, when: d.when });
    if (!r.ok) throw new Error(r.reason);
    return r;
  };

  it("a plain line comes back whole", () => {
    const d = draft();
    expect(back(d).draft).toEqual(normalizeDraft(d));
    expect(back(d).ids).toEqual(["s1", "s2", "s3"]);
  });

  it("every verb comes back as itself, even with the same words in the text", () => {
    const d = draft({
      steps: [
        { verb: "read", text: "اقرا المخزون" },
        { verb: "compare", text: "قارن: بالأمس" },
        { verb: "decide", text: "إذا نزل: عن الحد", elseGoto: 4 },
        { verb: "do", text: "نفّذ" },
        { verb: "wait_me", text: "استنى موافقتي" },
        { verb: "ask", text: "اطلب من حدا" },
        { verb: "tell", text: "بلّغ" },
      ],
    });
    expect(back(d).draft.steps).toEqual(normalizeDraft(d).steps);
  });

  it("the condition's «no» comes back, and «end» is what no «no» means", () => {
    const steps = (e: DraftStep["elseGoto"]): DraftStep[] => [
      { verb: "read", text: "a" },
      { verb: "decide", text: "b", elseGoto: e },
      { verb: "do", text: "c" },
      { verb: "do", text: "d" },
      { verb: "tell", text: "e" },
    ];
    expect(back(draft({ steps: steps(4) })).draft.steps[1]).toEqual({ verb: "decide", text: "b", elseGoto: 4 });
    expect(back(draft({ steps: steps(3) })).draft.steps[1]).toEqual({ verb: "decide", text: "b", elseGoto: 3 });
    expect(back(draft({ steps: steps("end") })).draft.steps[1]).toEqual({ verb: "decide", text: "b" });
    expect(back(draft({ steps: steps(undefined) })).draft).toEqual(normalizeDraft(draft({ steps: steps("end") })));
  });

  it("a draft with no steps comes back with none", () => {
    const trigger = { nodes: [{ id: "start", type: "trigger" as const, label: "x" }], edges: [] };
    const r = graphToDraft(trigger, rest);
    expect(r.ok && r.draft.steps).toEqual([]);
  });

  it("all the drafts the six templates make come back whole", async () => {
    const { JOB_TEMPLATES } = await import("@/core/job-templates");
    for (const t of JOB_TEMPLATES) {
      const d = { ...t.build(NOW), assigneeKey: t.build(NOW).assigneeKey || "member1" };
      expect(back(d).draft.steps, t.key).toEqual(normalizeDraft(d).steps);
    }
  });

  it("`rest` is the job's own fields, kept as they are", () => {
    const r = graphToDraft(draftToJob(draft(), NOW).graph, rest);
    expect(r.ok && r.draft).toMatchObject(rest);
  });
});

describe("a drawing that is not a plain line is said not to be one", () => {
  const node = (id: string, type: "trigger" | "step" | "condition" | "approval" | "wait" | "notify" = "step", label = id) => ({ id, type, label });
  const g = (nodes: ReturnType<typeof node>[], edges: [string, string, string?][]): WfGraph => ({ nodes, edges: edges.map(([from, to, label]) => ({ from, to, ...(label ? { label } : {}) })) });
  const reason = (graph: WfGraph) => {
    const r = graphToSteps(graph);
    return r.ok ? null : r.reason;
  };

  it("a fork that meets again, a node with two ways out, an orphan, a loop, a wait on a clock, and two starts", () => {
    expect(reason(g([node("start", "trigger"), node("a"), node("b"), node("c")], [["start", "a"], ["a", "b"], ["a", "c"]]))).toBe("فيها تفرّع");
    expect(reason(g([node("start", "trigger"), node("a", "condition"), node("b"), node("c")], [["start", "a"], ["a", "b"], ["a", "c"]]))).toBe("فيها تفرّع");
    expect(reason(g([node("start", "trigger"), node("a"), node("orphan")], [["start", "a"]]))).toBe("فيها خطوات مش موصولة بالباقي");
    expect(reason(g([node("start", "trigger"), node("a"), node("b")], [["start", "a"], ["a", "b"], ["b", "a"]]))).toBe("فيها دورة أو رابط مش مفهوم");
    expect(reason(g([node("start", "trigger"), node("a", "wait")], [["start", "a"]]))).toBe("فيها خطوة انتظار بوقت");
    expect(reason(g([node("start", "trigger"), node("t2", "trigger"), node("a")], [["start", "a"]]))).toBe("مش واضح منين بتبدأ");
    expect(reason(g([node("a"), node("b")], [["a", "b"]]))).toBe("مش واضح منين بتبدأ");
  });

  it("a «no» that goes back or to the very next step is a drawing of its own", () => {
    const base = [node("start", "trigger"), node("a"), node("c", "condition"), node("d"), node("e")];
    expect(reason(g(base, [["start", "a"], ["a", "c"], ["c", "d", "نعم"], ["c", "a", "لا"], ["d", "e"]]))).toBe("فيها تفرّع");
    expect(reason(g(base, [["start", "a"], ["a", "c"], ["c", "d", "نعم"], ["c", "d", "لا"], ["d", "e"]]))).toBe("فيها تفرّع");
    // a «no» alone, with no «yes» to carry on
    expect(reason(g(base, [["start", "a"], ["a", "c"], ["c", "e", "لا"]]))).toBe("فيها تفرّع");
  });

  it("a chain whose only odd thing is a condition with one line is a line (the jobs Claude pushed look like this)", () => {
    const r = graphToSteps(g([node("start", "trigger"), node("a"), node("judge", "condition", "فوق التعادل؟"), node("b")], [["start", "a"], ["a", "judge"], ["judge", "b"]]));
    expect(r).toMatchObject({ ok: true, ids: ["a", "judge", "b"] });
    expect(r.ok && r.steps.map((s) => s.verb)).toEqual(["do", "decide", "do"]);
  });

  it("the jobs the site was seeded with: every one is read, or said not to be a line — never an exception; the night round is a line", () => {
    for (const s of SEED_WORKFLOWS) expect(() => graphToSteps(s.graph), s.key).not.toThrow();
    const night = SEED_WORKFLOWS.find((s) => s.key === "night-round")!;
    const r = graphToSteps(night.graph);
    expect(r.ok && r.steps.map((x) => x.verb)).toEqual(["do", "decide", "do", "do", "wait_me", "tell"]);
    expect(r.ok && r.steps[0]!.text).toBe("قراءة آخر 3 أيام كاملة");
  });

  it("a node that is not a step of a job has no step (a trigger in the middle)", () => {
    expect(nodeToStep(node("t", "trigger"))).toBeNull();
    expect(nodeToStep(node("w", "wait"))).toBeNull();
  });
});

describe("editing a drawing that exists: the blocks keep what the owner did not touch", () => {
  const night = SEED_WORKFLOWS.find((s) => s.key === "night-round")!;
  const read = graphToSteps(night.graph);
  if (!read.ok) throw new Error("night-round must be a line");
  const keepOf = (ids: (string | null)[]) => ({ base: night.graph, ids });
  const build = (steps: DraftStep[], ids: (string | null)[]) => draftGraph(steps, { executor: "claude_mcp", triggerLabel: "x", keep: keepOf(ids) });

  it("nothing changed: every node is exactly what it was (its id, executor, badge, inputs and notes), and the graph is the same", () => {
    const g = build(read.steps, read.ids);
    expect(g.nodes).toEqual(night.graph.nodes);
    expect(g.nodes.map((n) => n.id)).toEqual(night.graph.nodes.map((n) => n.id));
    // the lines too: the condition's line that was never named stays unnamed, so a save that changed nothing is not a new version
    expect(g.edges).toEqual(night.graph.edges);
    expect(GraphSchema.safeParse(g).success).toBe(true);
    expect(isChanged(graphDiff(night.graph, settleLayout(night.graph, g)))).toBe(false);
  });

  it("a line that changed its meaning does not keep the old name: a «لا» line that becomes the «نعم» line loses it", () => {
    const withNo: WfGraph = {
      nodes: [{ id: "start", type: "trigger", label: "x" }, { id: "c", type: "condition", label: "إذا؟" }, { id: "a", type: "step", label: "a" }, { id: "b", type: "step", label: "b" }],
      edges: [{ from: "start", to: "c" }, { from: "c", to: "a", label: "نعم" }, { from: "c", to: "b", label: "لا" }, { from: "a", to: "b" }],
    };
    const r = graphToSteps(withNo);
    if (!r.ok) throw new Error(r.reason);
    // remove «a»: «b» is now the next step, and the old «لا» line to it must not stay as «لا»
    const g = draftGraph(removeStep(r.steps, 1), { executor: "claude_mcp", triggerLabel: "x", keep: { base: withNo, ids: removeItem(r.ids, 1) } });
    expect(g.edges).toEqual([{ from: "start", to: "c" }, { from: "c", to: "b", label: "نعم" }]);
  });

  it("the layout is asked for only when the steps or the lines changed: an edit that changed nothing is the drawing as it was; a new step lays the whole drawing out", () => {
    const same = build(read.steps, read.ids);
    expect(settleLayout(night.graph, same)).toBe(night.graph);
    const added = build([...read.steps, { verb: "read", text: "جديدة" }], [...read.ids, null]);
    const laid = settleLayout(night.graph, added);
    expect(laid).not.toBe(night.graph);
    expect(laid.nodes.every((n) => typeof n.x === "number" && typeof n.y === "number")).toBe(true);
    expect(laid.nodes).toHaveLength(night.graph.nodes.length + 1);
  });

  it("a text changed: that node takes the new label and keeps everything else; the others stay as they are", () => {
    const steps = read.steps.map((s, i) => (i === 2 ? { ...s, text: "إيقاف الخاسر بس" } : s));
    const g = build(steps, read.ids);
    const was = night.graph.nodes.find((n) => n.id === "pause")!;
    const now = g.nodes.find((n) => n.id === "pause")!;
    expect(now).toEqual({ ...was, label: "نفّذ: إيقاف الخاسر بس" });
    expect(g.nodes.filter((n) => n.id !== "pause")).toEqual(night.graph.nodes.filter((n) => n.id !== "pause"));
  });

  it("a step removed is gone, the line closes; a step added takes the first free id and is at the place it was put", () => {
    const steps = [...read.steps.slice(0, 2), ...read.steps.slice(3)];
    const ids = [...read.ids.slice(0, 2), ...read.ids.slice(3)];
    const g = build([...steps, { verb: "ask", text: "اسأل الفريق" }], [...ids, null]);
    expect(g.nodes.some((n) => n.id === "pause")).toBe(false);
    expect(g.nodes.at(-1)).toMatchObject({ id: "s1", type: "step", label: "اطلب من حدا: اسأل الفريق", executor: "person" });
    const line = graphToSteps(g);
    expect(line.ok && line.ids).toEqual(["read", "judge", "scale", "gate", "notify", "s1"]);
  });

  it("a new id never takes one that a node of the drawing already has", () => {
    const withS1: WfGraph = { nodes: [...night.graph.nodes, { id: "s1", type: "step", label: "x" }], edges: [...night.graph.edges, { from: "notify", to: "s1" }] };
    const r = graphToSteps(withS1);
    if (!r.ok) throw new Error(r.reason);
    const g = draftGraph([...r.steps, { verb: "read", text: "جديدة" }], { executor: "claude_mcp", triggerLabel: "x", keep: { base: withS1, ids: [...r.ids, null] } });
    expect(g.nodes.at(-1)!.id).toBe("s2");
  });

  it("a step switched off stays off through an edit that did not touch it", () => {
    const off: WfGraph = { ...night.graph, nodes: night.graph.nodes.map((n) => (n.id === "scale" ? { ...n, disabled: true } : n)) };
    const r = graphToSteps(off);
    expect(r.ok && r.off).toEqual([false, false, false, true, false, false]);
    if (!r.ok) return;
    const g = draftGraph(r.steps.map((s, i) => (i === 0 ? { ...s, text: "غيّرت" } : s)), { executor: "claude_mcp", triggerLabel: "x", keep: { base: off, ids: r.ids } });
    expect(g.nodes.find((n) => n.id === "scale")!.disabled).toBe(true);
  });

  it("the verb of a step changed: it keeps its id and takes the badge of the new verb", () => {
    const steps = read.steps.map((s, i) => (i === 0 ? { verb: "read" as const, text: s.text } : s));
    const g = build(steps, read.ids);
    const n = g.nodes.find((x) => x.id === "read")!;
    expect(n).toMatchObject({ label: "اقرا: قراءة آخر 3 أيام كاملة", permission: "green" });
    // one that is a different KIND of node (a step became a gate) is a new node under the same id
    const gate = build(read.steps.map((s, i) => (i === 0 ? { verb: "wait_me" as const, text: s.text } : s)), read.ids).nodes.find((x) => x.id === "read")!;
    expect(gate).toMatchObject({ id: "read", type: "approval", permission: "red" });
  });
});

describe("moving the blocks", () => {
  const steps = (): DraftStep[] => [
    { verb: "read", text: "a" },
    { verb: "decide", text: "b", elseGoto: 3 },
    { verb: "do", text: "c" },
    { verb: "tell", text: "d" },
  ];
  const texts = (s: DraftStep[]) => s.map((x) => x.text).join("");

  it("a step moves up and down, and at the edge nothing happens", () => {
    expect(texts(moveStep(steps(), 2, -1))).toBe("acbd");
    expect(texts(moveStep(steps(), 0, 1))).toBe("bacd");
    expect(texts(moveStep(steps(), 0, -1))).toBe("abcd");
    expect(texts(moveStep(steps(), 3, 1))).toBe("abcd");
  });

  it("a «no» follows the step it pointed at: when that step moves, it points at its new place", () => {
    // d (the target) moves up past c: the «no» of b points at index 2 now, which is the step after the next one? no: it is the very next step — «no» ends the job
    const moved = moveStep(steps(), 3, -1);
    expect(moved.map((s) => s.text).join("")).toBe("abdc");
    expect(moved[1]).toEqual({ verb: "decide", text: "b" });
    // a step in front of the condition moves behind it: indexes shift but the target is the same step
    const longer: DraftStep[] = [{ verb: "read", text: "a" }, { verb: "read", text: "x" }, { verb: "decide", text: "b", elseGoto: 4 }, { verb: "do", text: "c" }, { verb: "tell", text: "d" }];
    const m2 = moveStep(longer, 1, -1);
    expect(m2.map((s) => s.text).join("")).toBe("xabcd");
    expect(m2[2]).toEqual({ verb: "decide", text: "b", elseGoto: 4 });
  });

  it("removing a step: a «no» that pointed at it ends the job; one that pointed past it points one earlier", () => {
    const gone = removeStep(steps(), 3);
    expect(texts(gone)).toBe("abc");
    expect(gone[1]).toEqual({ verb: "decide", text: "b" });
    const longer: DraftStep[] = [{ verb: "read", text: "a" }, { verb: "decide", text: "b", elseGoto: 4 }, { verb: "do", text: "c" }, { verb: "do", text: "x" }, { verb: "tell", text: "d" }];
    const r = removeStep(longer, 2);
    expect(texts(r)).toBe("abxd");
    expect(r[1]).toEqual({ verb: "decide", text: "b", elseGoto: 3 });
    // the condition itself removed: nothing points at anything
    expect(texts(removeStep(steps(), 1))).toBe("acd");
  });

  it("a «no» that no longer skips a step (it would point at the next one) ends the job", () => {
    const r = removeStep([{ verb: "decide", text: "b", elseGoto: 2 }, { verb: "do", text: "x" }, { verb: "tell", text: "d" }].map((s) => ({ ...s })) as DraftStep[], 1);
    expect(r[0]).toEqual({ verb: "decide", text: "b" });
  });

  it("the block's edits: add (up to the limit), change a text, set a «no»; the others are untouched and the old list is not changed", () => {
    const base = steps();
    const added = addStep(base, "ask");
    expect(added).toHaveLength(5);
    expect(added[4]).toEqual({ verb: "ask", text: "" });
    expect(base).toHaveLength(4);
    expect(addStep(Array.from({ length: MAX_STEPS }, () => ({ verb: "read" as const, text: "a" })), "read")).toHaveLength(MAX_STEPS);
    expect(setStepText(base, 0, "قرا")[0]!.text).toBe("قرا");
    expect(base[0]!.text).toBe("a");
    expect(setElse(base, 1, "end")[1]).toEqual({ verb: "decide", text: "b" });
    expect(setElse(base, 1, 3)[1]).toEqual({ verb: "decide", text: "b", elseGoto: 3 });
    // only a condition has one
    expect(setElse(base, 0, 3)[0]).toEqual({ verb: "read", text: "a" });
  });
});

describe("the words", () => {
  it("the bar under the builder: who · when · steps · who is told", () => {
    expect(draftSentence(draft(), { claude: "Claude الرئيسي" })).toBe("Claude الرئيسي · كل يوم 09:30 · 3 خطوات · بخبّرك لما توقف أو تفوت");
    expect(draftSentence(draft({ assigneeKey: "site", steps: [], recipe: { name: "stock_alert", params: {} }, notifyOn: ["done", "stuck", "missed", "failed"] }))).toBe("الموقع لحاله · كل يوم 09:30 · وصفة جاهزة · بخبّرك لما تخلص أو توقف");
    expect(draftSentence(draft({ steps: [{ verb: "read", text: "a" }], notifyOn: ["missed", "failed"] }))).toBe("claude · كل يوم 09:30 · خطوة وحدة · بخبّرك بس لو في شي مهم");
    expect(draftSentence(draft({ steps: [] }))).toContain("0 خطوات");
    expect(draftSentence(draft({ assigneeKey: "" }))).toMatch(/^مين؟/);
  });

  it("the four ways to say «when»", () => {
    expect(whenWords({ kind: "now" })).toBe("هلق");
    expect(whenWords({ kind: "once", date: "2026-11-26", time: "09:00" })).toBe("مرة وحدة: الخميس 2026-11-26 09:00");
    expect(whenWords({ kind: "hourly", from: "10:00", to: "22:00", everyHours: 3 })).toBe("كل 3 ساعات من 10:00 لـ22:00");
    expect(whenWords({ kind: "hourly", from: "10:00", to: "22:00", everyHours: 1 })).toBe("كل ساعة من 10:00 لـ22:00");
    expect(whenWords({ kind: "weekly", days: [0, 1, 2, 3, 4, 5, 6], time: "08:00" })).toBe("كل يوم 08:00");
    expect(whenWords({ kind: "weekly", days: [4], time: "08:00" })).toBe("كل الخميس 08:00");
  });

  it("the three choices of «إيمتى أخبّرك؟» are three lists, each told back as the same choice; a list of its own is told as such", () => {
    expect(NOTIFY_PRESETS.map((p) => p.on)).toEqual([["done", "stuck", "missed", "failed"], ["stuck", "missed", "failed"], ["missed", "failed"]]);
    expect(presetOf(["failed", "stuck", "missed"])).toBe("stop");
    expect(presetOf(["failed"])).toBeNull();
    expect(notifyWords([])).toBe("بلا إشعارات");
    expect(notifyWords(["failed"])).toBe("بخبّرك حسب اللي اخترته");
  });

  it("a name from the first step that has a text", () => {
    expect(suggestName([{ verb: "read", text: "المخزون" }])).toBe("اقرا المخزون");
    expect(suggestName([{ verb: "read", text: "  " }, { verb: "tell", text: "ابعت" }])).toBe("بلّغ ابعت");
    expect(suggestName([])).toBe("");
    expect(suggestName([{ verb: "read", text: "x".repeat(100) }]).length).toBeLessThanOrEqual(60);
  });

  it("an empty draft is a start, not a valid job", () => {
    expect(emptyDraft().steps).toEqual([]);
    expect(validateDraft(emptyDraft(), NOW)).toMatchObject({ ok: false, field: "assigneeKey" });
    // the checks go in the order of the screen: with a doer, a time and a step the empty name is what is left
    expect(validateDraft(emptyDraft({ assigneeKey: "claude", steps: [{ verb: "read", text: "a" }] }), NOW)).toMatchObject({ ok: false, field: "name", message: "اكتب اسم للمهمة" });
  });
});

describe("a one-time job for a person is a task", () => {
  it("only for a person, only one-time, never a recipe", () => {
    const once = { kind: "once", date: "2026-11-25", time: "09:00" } as const;
    expect(isPersonTask({ when: once }, "person")).toBe(true);
    expect(isPersonTask({ when: { kind: "now" } }, "person")).toBe(true);
    expect(isPersonTask({ when: once }, "agent")).toBe(false);
    expect(isPersonTask({ when: { kind: "daily", time: "09:00" } }, "person")).toBe(false);
    expect(isPersonTask({ when: once, recipe: { name: "remind", params: {} } }, "person")).toBe(false);
  });

  it("its title is the name, its note the steps in order, its time the moment (the Amman clock) or now", () => {
    const d = draft({ assigneeKey: "member1", when: { kind: "once", date: "2026-11-25", time: "09:00" }, steps: [{ verb: "do", text: "ردّ على الرسالة" }, { verb: "tell", text: "بلّغني" }] });
    const t = draftToTask(d, NOW);
    expect(t).toMatchObject({ title: "فحص المخزون", note: "1. نفّذ: ردّ على الرسالة\n2. بلّغ: بلّغني", assignee: "member1" });
    expect(t.dueAt.toISOString()).toBe("2026-11-25T06:00:00.000Z");
    expect(draftToTask({ ...d, when: { kind: "now" } }, NOW).dueAt.toISOString()).toBe(NOW.toISOString());
    expect(() => draftToTask({ ...d, when: { kind: "once", date: "2026-11-01", time: "09:00" } }, NOW)).toThrow();
  });
});

describe("what the form needs: a sound «when» for every tile, the two boxes of an instant, the steps alone", () => {
  it("every tile gives a «when» that passes the check, the first time it is pressed", () => {
    for (const kind of ["now", "once", "daily", "hourly", "weekly", "window"] as const) {
      const w = defaultWhen(kind, NOW);
      expect(w.kind).toBe(kind);
      expect(validateDraft(draft({ when: w }), NOW), kind).toEqual({ ok: true });
    }
    expect(defaultWhen("once", NOW)).toEqual({ kind: "once", date: "2026-11-23", time: "09:00" });
    // tomorrow is a Monday: 1
    expect(defaultWhen("weekly", NOW)).toEqual({ kind: "weekly", days: [1], time: "09:30" });
  });

  it("the time the owner already chose on another tile stays; so does the step of the hours", () => {
    expect(defaultWhen("once", NOW, { kind: "daily", time: "21:15" })).toMatchObject({ time: "21:15" });
    expect(defaultWhen("weekly", NOW, { kind: "once", date: "2026-12-01", time: "08:05" })).toMatchObject({ time: "08:05" });
    expect(defaultWhen("window", NOW, { kind: "hourly", from: "10:00", to: "22:00", everyHours: 4 })).toMatchObject({ everyHours: 4 });
    const h = { kind: "hourly", from: "08:00", to: "12:00", everyHours: 1 } as const;
    expect(defaultWhen("hourly", NOW, h)).toBe(h);
  });

  it("the end of the day: 23:59 on the Amman clock; tomorrow's when today's is under half an hour away", () => {
    expect(endOfDay(NOW)).toBe("2026-11-22T20:59:00.000Z");
    expect(endOfDay(ammanInstant("2026-11-22", "23:45")!)).toBe("2026-11-23T20:59:00.000Z");
    expect(endOfDay(ammanInstant("2026-11-22", "23:20")!)).toBe("2026-11-22T20:59:00.000Z");
  });

  it("an instant is a day and a time on the Amman clock, and back", () => {
    expect(splitInstant("2026-11-22T20:59:00.000Z")).toEqual({ date: "2026-11-22", time: "23:59" });
    expect(splitInstant("2026-11-22T21:30:00.000Z")).toEqual({ date: "2026-11-23", time: "00:30" });
    expect(splitInstant("nope")).toBeNull();
    expect(joinInstant("2026-11-22", "23:59")).toBe("2026-11-22T20:59:00.000Z");
    expect(joinInstant("", "23:59")).toBeNull();
    expect(joinInstant("2026-11-22", "")).toBeNull();
  });

  it("the steps alone: none is fine (a recipe has none), a bad one says which", () => {
    expect(validateSteps([])).toEqual({ ok: true });
    expect(validateSteps([{ verb: "read", text: "a" }])).toEqual({ ok: true });
    expect(validateSteps([{ verb: "read", text: "" }])).toMatchObject({ ok: false, field: "steps[0].text", message: "اكتب نص الخطوة 1" });
    expect(validateSteps([{ verb: "decide", text: "a", elseGoto: 1 }, { verb: "read", text: "b" }])).toMatchObject({ ok: false, field: "steps[0].elseGoto" });
  });
});
