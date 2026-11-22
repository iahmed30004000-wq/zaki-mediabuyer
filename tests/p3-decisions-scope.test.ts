/**
 * Three small guards of P3: S-19 (a person changes only the tasks of their own scope), W-09 (every option of a request is a button and is sent by its key) and W-19 (a step is named to
 * the agent by the number the owner sees). The words of a job's badge (U-05 · U-09) are checked here too: «مفعّلة» is the switch, «شغّالة» is a run, a request in the queue is not a stop.
 */
import { describe, expect, it } from "vitest";
import { fromApproval, optionActions, type ApprovalIn } from "@/core/inbox";
import { jobCounters, jobStatus, stepNumberOf, type JobLike } from "@/core/jobs";
import { OUT_OF_SCOPE_SENTENCE, tasksOutOfScope } from "@/core/task-scope";
import type { WfGraph } from "@/core/workflow";

describe("S-19 — whose tasks a person may change by id", () => {
  const rows = [
    { id: "t1", assignee: "member-a" },
    { id: "t2", assignee: "member-b" },
    { id: "t3", assignee: null },
  ];

  it("everything is in scope for a role that sees all (keys = null)", () => {
    expect(tasksOutOfScope(["t1", "t2", "t3", "ghost"], rows, null)).toEqual([]);
  });

  it("a team lead's scope: their own team's tasks are in; another team's, an unassigned one and one that does not exist are out", () => {
    expect(tasksOutOfScope(["t1"], rows, ["member-a", "lead"])).toEqual([]);
    expect(tasksOutOfScope(["t1", "t2"], rows, ["member-a", "lead"])).toEqual(["t2"]);
    expect(tasksOutOfScope(["t3"], rows, ["member-a"])).toEqual(["t3"]);
    expect(tasksOutOfScope(["ghost"], rows, ["member-a"])).toEqual(["ghost"]);
  });

  it("one task out of a hundred is enough to refuse the whole press; an empty scope owns nothing; a repeated id counts once", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: `x${i}`, assignee: "member-a" }));
    expect(tasksOutOfScope([...many.map((m) => m.id), "t2"], [...many, ...rows], ["member-a"])).toEqual(["t2"]);
    expect(tasksOutOfScope(["t1"], rows, [])).toEqual(["t1"]);
    expect(tasksOutOfScope(["t2", "t2"], rows, ["member-a"])).toEqual(["t2"]);
    expect(OUT_OF_SCOPE_SENTENCE).toBe("هاي مهمة مش مهمتك");
  });
});

describe("W-09 — every option of a request is a button, sent by its own key", () => {
  const approval = (options: { key: string; label: string }[], over: Partial<ApprovalIn> = {}): ApprovalIn => ({ id: "a1", title: "كبّر المجموعة؟", why: "تكلفة الطلب تحت السقف", numbers: [], options, amount: 50, urgency: "orange", kind: null, source: "mcp", workflowKey: "night", expiresAt: null, postponedUntil: null, createdAt: "2026-11-22T10:00:00.000Z", ...over });

  it("three options are three buttons (and «أجّل»), in the agent's order; the first is the main one", () => {
    const i = fromApproval(approval([{ key: "up20", label: "كبّر 20%" }, { key: "up10", label: "كبّر 10%" }, { key: "hold", label: "خلّيها" }]));
    expect(i.actions.map((a) => a.label)).toEqual(["كبّر 20%", "كبّر 10%", "خلّيها", "أجّل"]);
    expect(i.actions.map((a) => a.option)).toEqual(["up20", "up10", "hold", undefined]);
    expect(i.actions.map((a) => a.variant)).toEqual(["primary", "secondary", "secondary", "ghost"]);
  });

  it("only the option whose key is «reject» is a refusal; any other option is an answer of its own (never squeezed into a refusal)", () => {
    const i = fromApproval(approval([{ key: "approve", label: "وافق" }, { key: "smaller", label: "بمبلغ أقل" }, { key: "reject", label: "ارفض" }]));
    expect(i.actions.map((a) => a.key)).toEqual(["approve", "choose", "reject", "later"]);
    expect(i.actions[1]).toMatchObject({ key: "choose", option: "smaller" });
    expect(i.actions[2]).toMatchObject({ key: "reject", option: "reject" });
  });

  it("the default two options still read «وافق / ارفض»; a message to the team is «ابعت» and needs the operations right", () => {
    const d = optionActions([], false, "owner_only");
    expect(d.map((a) => [a.key, a.label])).toEqual([["approve", "وافق"], ["reject", "ارفض"]]);
    const m = fromApproval(approval([{ key: "approve", label: "ابعت" }, { key: "edit", label: "عدّلها" }, { key: "reject", label: "لا" }], { kind: "send_message", amount: null, analysis: { text: "أهلاً" } }));
    expect(m.actions.map((a) => a.key)).toEqual(["send", "choose", "reject", "later"]);
    expect(m.actions.every((a) => a.capability === "ops.send")).toBe(true);
  });

  it("at most five options are drawn", () => {
    const opts = Array.from({ length: 8 }, (_, i) => ({ key: `o${i}`, label: `خيار ${i}` }));
    expect(optionActions(opts, false, "owner_only")).toHaveLength(5);
  });
});

describe("W-19 — a step is named by the number on the screen", () => {
  // the list of nodes is NOT the running order: the edges say a → c → b
  const graph: WfGraph = {
    nodes: [
      { id: "start", type: "trigger", label: "بداية" },
      { id: "b", type: "step", label: "ب" },
      { id: "c", type: "step", label: "ج" },
      { id: "a", type: "step", label: "أ" },
    ],
    edges: [{ from: "start", to: "a" }, { from: "a", to: "c" }, { from: "c", to: "b" }],
  };

  it("«11.1» is the step that runs first, whatever its place in the drawing's list", () => {
    expect(stepNumberOf({ key: "k", number: 11, graph }, "a")).toBe("11.1");
    expect(stepNumberOf({ key: "k", number: 11, graph }, "c")).toBe("11.2");
    expect(stepNumberOf({ key: "k", number: 11, graph }, "b")).toBe("11.3");
  });

  it("a job with no number, or a step it no longer has, is named by its key", () => {
    expect(stepNumberOf({ key: "k", number: null, graph }, "a")).toBe("k/a");
    expect(stepNumberOf({ key: "k", number: 4, graph }, "gone")).toBe("k/gone");
  });
});

describe("the badge of a job — one word each (U-05 · U-09)", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");
  const job = (over: Partial<JobLike> = {}): JobLike => ({ enabled: true, kind: "recurring", schedule: "0 9 * * *", scheduleText: null, runsAt: null, endsAt: null, finishedAt: null, ...over });

  it("the switch is «مفعّلة» / «مطفية»; «شغّالة» only while a run is going", () => {
    expect(jobStatus(job(), null, now)).toMatchObject({ key: "on", label: "مفعّلة", tone: "ok" });
    expect(jobStatus(job(), { status: "ok" }, now)).toMatchObject({ key: "on", label: "مفعّلة" });
    expect(jobStatus(job({ enabled: false }), null, now)).toMatchObject({ key: "paused", label: "مطفية" });
    expect(jobStatus(job(), { status: "running" }, now)).toMatchObject({ key: "running", label: "شغّالة", tone: "info" });
  });

  it("a request still in the queue is «بانتظار <مين>» in orange — not a red stop, and not a problem in the counters", () => {
    const b = jobStatus(job(), { status: "queued" }, now, false, "Claude الرئيسي");
    expect(b).toMatchObject({ key: "queued", label: "بانتظار Claude الرئيسي", tone: "warn" });
    expect(jobStatus(job(), { status: "queued" }, now).label).toBe("بانتظار حدا ياخدها");
    expect(jobCounters([b]).problem).toBe(0);
    expect(jobCounters([b]).running).toBe(1);
  });

  it("a stop is «وقفت», a loss is «انقطعت», a miss is «فاتت», a step that needs somebody is «واقفة — بدها حدا»; «موقوفة» and «متوقفة» are gone", () => {
    expect(jobStatus(job(), { status: "failed" }, now).label).toBe("وقفت");
    expect(jobStatus(job(), { status: "lost" }, now)).toMatchObject({ label: "انقطعت", tone: "danger" });
    expect(jobStatus(job(), { status: "missed" }, now).label).toBe("فاتت");
    expect(jobStatus(job(), { status: "waiting" }, now, true)).toMatchObject({ key: "stuck", label: "واقفة — بدها حدا", tone: "warn" });
    const all = [jobStatus(job({ enabled: false }), null, now), jobStatus(job(), { status: "failed" }, now), jobStatus(job(), { status: "waiting" }, now, true)];
    for (const b of all) expect(b.label).not.toMatch(/موقوفة|متوقفة/);
  });

  it("the counters: «مشكلة» is a stop, a request that waits for somebody, or a miss", () => {
    const c = jobCounters([jobStatus(job(), { status: "failed" }, now), jobStatus(job(), { status: "waiting" }, now, true), jobStatus(job(), { status: "missed" }, now), jobStatus(job(), null, now)]);
    expect(c).toMatchObject({ total: 4, problem: 3, running: 1 });
  });
});
