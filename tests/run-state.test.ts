import { describe, expect, it } from "vitest";
import {
  agentMove,
  disabledStepIds,
  isLiveRun,
  isTerminalRun,
  nodeStatusOnComplete,
  resumePoint,
  retryNodeState,
  runLamp,
  runSentence,
  runSteps,
  skipNodeState,
  statusOnComplete,
  stepAfter,
  stepLamp,
  stepsAreInferred,
  type JobSteps,
  type RunView,
} from "@/core/run-state";
import { AGENT_RUN_STATUSES, NODE_STATUSES, RUN_STATUSES, TERMINAL_RUN_STATUSES, mergeNodeStates, settleStates, type NodeState, type NodeStates, type WfGraph } from "@/core/workflow";

const at = "2026-11-22T10:00:00.000Z";
const later = "2026-11-22T10:05:00.000Z";
const chain = (ids: string[], extra: Partial<Record<string, object>> = {}): WfGraph => {
  const nodes = [{ id: "start", type: "trigger" as const, label: "بداية" }, ...ids.map((id) => ({ id, type: "step" as const, label: `خطوة ${id}`, ...(extra[id] ?? {}) }))];
  return { nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) };
};
const job = (ids: string[], more: Partial<JobSteps> = {}): JobSteps => ({ graph: chain(ids), ...more });
const run = (over: Partial<RunView> & Pick<RunView, "status">): RunView => ({ startedAt: at, nodeStates: {}, ...over });
const st = (status: NodeState["status"], more: Partial<NodeState> = {}): NodeState => ({ status, at, ...more });

describe("the statuses (docs/rebuild-v6/01-model.md §3 · §4)", () => {
  it("a step may be skipped; a run may be queued, missed or lost — and an agent sends none of the last three", () => {
    expect(NODE_STATUSES).toContain("skipped");
    expect([...RUN_STATUSES].sort()).toEqual(["failed", "lost", "missed", "ok", "queued", "running", "skipped", "waiting"]);
    expect([...AGENT_RUN_STATUSES].sort()).toEqual(["failed", "ok", "running", "skipped", "waiting"]);
    expect([...TERMINAL_RUN_STATUSES].sort()).toEqual(["failed", "lost", "missed", "ok", "skipped"]);
  });

  it("ended and live are the two halves", () => {
    for (const s of RUN_STATUSES) expect(isTerminalRun(s) !== isLiveRun(s), s).toBe(true);
    expect(isLiveRun("queued")).toBe(true);
    expect(isTerminalRun("lost")).toBe(true);
  });
});

describe("the lamps", () => {
  it("a step lights by what it is doing; a step set aside or not reached is off", () => {
    expect(stepLamp(undefined)).toBe("off");
    expect(stepLamp(st("waiting"))).toBe("off");
    expect(stepLamp(st("skipped"))).toBe("off");
    expect(stepLamp(st("running"))).toBe("run");
    expect(stepLamp(st("done"))).toBe("done");
    expect(stepLamp(st("failed"))).toBe("fail");
    expect(stepLamp(st("handoff"))).toBe("wait");
    expect(stepLamp(st("approval"))).toBe("wait");
  });

  it("a run lights from its status: queued is orange and steady, lost is red, missed is dotted", () => {
    expect(runLamp({ status: "queued" })).toBe("wait");
    expect(runLamp({ status: "running" })).toBe("run");
    expect(runLamp({ status: "waiting" })).toBe("wait");
    expect(runLamp({ status: "ok" })).toBe("done");
    expect(runLamp({ status: "failed" })).toBe("fail");
    expect(runLamp({ status: "lost" })).toBe("fail");
    expect(runLamp({ status: "missed" })).toBe("missed");
    expect(runLamp({ status: "skipped" })).toBe("off");
    expect(runLamp({ status: "nonsense" })).toBe("off");
  });
});

describe("the sentence under the rope", () => {
  const now = new Date("2026-11-22T10:30:00.000Z");
  const j = job(["a", "b", "c"], { assigneeName: "Claude الرئيسي" });

  it("running: where it is, out of how many, and what it is doing", () => {
    expect(runSentence(j, run({ status: "running", nodeStates: { a: st("done"), b: st("running") } }), now)).toBe("هلق عند الخطوة 2 من 3 — خطوة b");
  });

  it("a trigger and a switched-off step are not counted", () => {
    const g = chain(["a", "b", "c"], { b: { disabled: true } });
    expect(runSteps(g).map((n) => n.id)).toEqual(["a", "c"]);
    expect(runSentence({ graph: g }, run({ status: "running", nodeStates: { c: st("running") } }), now)).toBe("هلق عند الخطوة 2 من 2 — خطوة c");
  });

  it("queued: who it waits for, and for how long", () => {
    expect(runSentence(j, run({ status: "queued", startedAt: "2026-11-22T10:18:00.000Z" }), now)).toBe("بانتظار Claude الرئيسي من 12 دقيقة");
    expect(runSentence(job(["a"]), run({ status: "queued", scheduledFor: "2026-11-22T08:30:00.000Z" }), now)).toBe("بانتظار حدا ياخدها من ساعتين");
  });

  it("failed: where it stopped and why (the error first, then the note)", () => {
    expect(runSentence(j, run({ status: "failed", nodeStates: { a: st("done"), b: st("failed", { error: "ما قدرنا نقرا المخزون", note: "x" }) } }), now)).toBe("وقفت عند 2: ما قدرنا نقرا المخزون");
    expect(runSentence(j, run({ status: "failed", nodeStates: { a: st("failed", { note: "انرفض" }) } }), now)).toBe("وقفت عند 1: انرفض");
    expect(runSentence(j, run({ status: "failed", summary: "خلص الرصيد" }), now)).toBe("وقفت: خلص الرصيد");
  });

  it("waiting: on a gate, or on somebody", () => {
    expect(runSentence(j, run({ status: "waiting", nodeStates: { b: st("approval") } }), now)).toBe("واقفة عند 2: بانتظار موافقتك");
    expect(runSentence(j, run({ status: "waiting", nodeStates: { c: st("handoff", { note: "بدها ربط" }) } }), now)).toBe("واقفة عند 3: بدها ربط");
  });

  it("missed and lost say so", () => {
    expect(runSentence(j, run({ status: "missed" }), now)).toBe("فاتت: ما وصل أي تسجيل");
    expect(runSentence(j, run({ status: "lost", heartbeatAt: "2026-11-22T09:30:00.000Z", nodeStates: { b: st("failed") } }), now)).toBe("انقطعت عند 2: آخر خبر من ساعة");
  });

  it("skipped says who ended it; ok says only the end when the agent told no steps", () => {
    expect(runSentence(j, run({ status: "skipped", endReason: "cancelled" }), now)).toBe("ألغيتها");
    expect(runSentence(j, run({ status: "skipped", endReason: "owner_skipped" }), now)).toBe("تخطّيتها");
    expect(runSentence(j, run({ status: "ok", summary: "تم", nodeStates: { a: st("done") } }), now)).toBe("خلصت — تم");
    expect(runSentence(j, run({ status: "ok", nodeStates: { a: st("done", { inferred: true }), b: st("done", { inferred: true }) } }), now)).toBe("خلصت — Claude سجّل النهاية بس، بلا تفاصيل الخطوات");
  });

  it("a step is inferred only when every state was guessed by the site", () => {
    expect(stepsAreInferred({ nodeStates: {} })).toBe(false);
    expect(stepsAreInferred({ nodeStates: { a: st("done", { inferred: true }) } })).toBe(true);
    expect(stepsAreInferred({ nodeStates: { a: st("done", { inferred: true }), b: st("done") } })).toBe(false);
  });
});

describe("the times of a step (§3 · mergeNodeStates)", () => {
  it("the first «running» writes startedAt; done writes endedAt and keeps it; running again does not move it", () => {
    let s: NodeStates = mergeNodeStates({}, [{ id: "a", status: "running" }], at);
    expect(s.a).toMatchObject({ status: "running", startedAt: at });
    expect(s.a!.endedAt).toBeUndefined();
    s = mergeNodeStates(s, [{ id: "a", status: "running", note: "لسا" }], later);
    expect(s.a!.startedAt).toBe(at);
    s = mergeNodeStates(s, [{ id: "a", status: "done" }], later);
    expect(s.a).toMatchObject({ status: "done", startedAt: at, endedAt: later });
  });

  it("failed and skipped end it too; the error is cut at 300 and stays with the step", () => {
    const s = mergeNodeStates({ a: st("running", { startedAt: at }) }, [{ id: "a", status: "failed", error: "x".repeat(400) }, { id: "b", status: "skipped" }], later);
    expect(s.a).toMatchObject({ status: "failed", startedAt: at, endedAt: later });
    expect(s.a!.error).toHaveLength(300);
    expect(s.b).toMatchObject({ status: "skipped", endedAt: later });
  });

  it("running a step that had ended is a new try: attempt + 1, the old end and error are gone", () => {
    const s = mergeNodeStates({ a: st("failed", { startedAt: at, endedAt: at, error: "قديم" }) }, [{ id: "a", status: "running" }], later);
    expect(s.a).toMatchObject({ status: "running", startedAt: later, attempt: 2 });
    expect(s.a!.endedAt).toBeUndefined();
    expect(s.a!.error).toBeUndefined();
    expect(mergeNodeStates(s, [{ id: "a", status: "failed" }], later).a!.attempt).toBe(2);
  });

  it("a step that waits (a gate, a handoff) and goes on keeps its start", () => {
    const s = mergeNodeStates({ a: st("handoff", { startedAt: at }) }, [{ id: "a", status: "running" }], later);
    expect(s.a!.startedAt).toBe(at);
    expect(s.a!.attempt).toBeUndefined();
  });

  it("a step the drawing does not know is skipped when asked to (the old behaviour stays)", () => {
    expect(Object.keys(mergeNodeStates({}, [{ id: "ghost", status: "done" }], at, new Set(["a"])))).toEqual([]);
  });
});

describe("what the site guesses is marked (settleStates · inferred)", () => {
  const g = chain(["a", "b"]);
  it("a finished run marks every step it filled in as inferred, and leaves the agent's own alone", () => {
    const s = settleStates(g, { a: st("done", { startedAt: at, endedAt: at }) }, "ok", later);
    expect(s.a!.inferred).toBeUndefined();
    expect(s.b).toMatchObject({ status: "done", inferred: true, endedAt: later });
    expect(s.start).toMatchObject({ status: "done", inferred: true });
  });

  it("a step set aside is not turned into done by the end of the run", () => {
    expect(settleStates(g, { a: st("skipped") }, "ok", later).a!.status).toBe("skipped");
  });

  it("a failed or lost run turns the running step red (inferred, with the end time)", () => {
    for (const status of ["failed", "lost"] as const) {
      const s = settleStates(g, { a: st("running", { startedAt: at }) }, status, later);
      expect(s.a).toMatchObject({ status: "failed", inferred: true, endedAt: later, startedAt: at });
    }
  });

  it("a lost run with nothing running invents no failure; a failed one marks the first unfinished step", () => {
    expect(settleStates(g, {}, "lost", later)).toEqual({});
    expect(settleStates(g, {}, "failed", later).start).toMatchObject({ status: "failed", inferred: true });
  });

  it("a cancelled run sets aside what was running or waiting", () => {
    const s = settleStates(g, { a: st("done"), b: st("handoff") }, "skipped", later);
    expect(s.a!.status).toBe("done");
    expect(s.b).toMatchObject({ status: "skipped", inferred: true });
  });

  it("a run that only says «started» still moves, and says it guessed", () => {
    const s = settleStates(g, {}, "running", at);
    expect(s.start).toMatchObject({ status: "done", inferred: true });
    expect(s.a).toMatchObject({ status: "running", inferred: true, startedAt: at });
  });
});

describe("what an agent may do to a run (agentMove)", () => {
  it("never writes queued · missed · lost", () => {
    for (const to of ["queued", "missed", "lost"]) expect(agentMove("running", to).ok, to).toBe(false);
    expect(agentMove(undefined, "queued")).toMatchObject({ ok: false });
  });

  it("a run that has ended is not opened again by «running» or «waiting» — but may be corrected to another end", () => {
    for (const from of ["ok", "failed", "skipped", "missed", "lost"]) {
      expect(agentMove(from, "running").ok, from).toBe(false);
      expect(agentMove(from, "waiting").ok, from).toBe(false);
    }
    expect(agentMove("ok", "failed").ok).toBe(true);
    expect(agentMove("ok", "ok").ok).toBe(true);
  });

  it("every other move is fine, a new run begins with anything the agent may say", () => {
    expect(agentMove(undefined, "running").ok).toBe(true);
    expect(agentMove("queued", "running").ok).toBe(true);
    expect(agentMove("waiting", "running").ok).toBe(true);
    expect(agentMove("running", "waiting").ok).toBe(true);
  });

  it("a run the owner cancelled stays cancelled", () => {
    expect(agentMove("skipped", "ok", { cancelled: true })).toMatchObject({ ok: false });
    expect(agentMove("skipped", "skipped", { cancelled: true }).ok).toBe(true);
  });
});

describe("answering a request does not turn a failure into a success (§7 · W-04)", () => {
  const live = (nodeStates: NodeStates = {}) => ({ status: "running", nodeStates });
  it("the answer's own word wins", () => {
    expect(statusOnComplete("manual_run", "failed", live())).toBe("failed");
    expect(statusOnComplete("node_failed", "ok", live())).toBe("ok");
    expect(statusOnComplete("manual_run", "running", live())).toBe("running");
  });

  it("a «running» answered late does not reopen a run that ended", () => {
    expect(statusOnComplete("node_failed", "running", { status: "failed", nodeStates: {} })).toBeUndefined();
  });

  it("without a word: a run that ended stays as it ended", () => {
    for (const status of ["ok", "failed", "skipped", "missed", "lost"]) expect(statusOnComplete("manual_run", undefined, { status, nodeStates: {} }), status).toBeUndefined();
  });

  it("without a word: a request about a stuck step only unblocks the run (it goes on), as it always did", () => {
    for (const kind of ["node_failed", "missing_connection", "timeout", "needs_input"]) expect(statusOnComplete(kind, undefined, live()), kind).toBe("running");
  });

  it("without a word: a run the owner asked for ends ok — unless one of its steps failed", () => {
    expect(statusOnComplete("manual_run", undefined, live({ a: st("done") }))).toBe("ok");
    expect(statusOnComplete("resume", undefined, { status: "queued", nodeStates: {} })).toBe("ok");
    expect(statusOnComplete("manual_run", undefined, live({ a: st("failed") }))).toBeUndefined();
  });

  it("no run to read: nothing to say", () => {
    expect(statusOnComplete("manual_run", undefined, null)).toBeUndefined();
  });

  it("the step the request held becomes done (failed if the run failed) — and one that ended stays", () => {
    expect(nodeStatusOnComplete("ok", st("handoff"))).toBe("done");
    expect(nodeStatusOnComplete(undefined, st("running"))).toBe("done");
    expect(nodeStatusOnComplete("failed", st("running"))).toBe("failed");
    expect(nodeStatusOnComplete("ok", st("failed"))).toBeUndefined();
    expect(nodeStatusOnComplete("ok", st("skipped"))).toBeUndefined();
    expect(nodeStatusOnComplete("ok", st("done"))).toBeUndefined();
  });
});

describe("the owner's buttons on a run that stopped (§8)", () => {
  const g = chain(["a", "b", "c", "d"]);

  it("a retry picks up at the first failed step; else at the one that waits or was running; else at the first not finished", () => {
    expect(resumePoint(g, { a: st("done"), b: st("failed"), c: st("running") })).toMatchObject({ node: { id: "b" }, n: 2 });
    expect(resumePoint(g, { a: st("done"), b: st("done"), c: st("approval") })).toMatchObject({ node: { id: "c" }, n: 3 });
    expect(resumePoint(g, { a: st("done"), b: st("done") })).toMatchObject({ node: { id: "c" }, n: 3 });
    expect(resumePoint(g, { a: st("done"), b: st("done"), c: st("skipped"), d: st("done") })).toBeNull();
  });

  it("a switched-off step is never where it picks up", () => {
    expect(resumePoint(chain(["a", "b"], { a: { disabled: true } }), {})).toMatchObject({ node: { id: "b" }, n: 1 });
  });

  it("the step after one, or nothing after the last", () => {
    expect(stepAfter(g, "b")).toMatchObject({ node: { id: "c" }, n: 3 });
    expect(stepAfter(g, "d")).toBeNull();
    expect(stepAfter(g, "zzz")).toBeNull();
  });

  it("a retry sends the step back to waiting, one try more, with nothing of its old end", () => {
    const s = retryNodeState({ b: st("failed", { startedAt: at, endedAt: at, error: "قديم", attempt: 2 }) }, "b", later);
    expect(s.b).toMatchObject({ status: "waiting", attempt: 3 });
    expect(s.b!.error).toBeUndefined();
    expect(s.b!.endedAt).toBeUndefined();
    expect(retryNodeState({}, "b", later).b!.attempt).toBe(2);
  });

  it("a skip sets the step aside and says who did it", () => {
    const s = skipNodeState({ b: st("failed", { startedAt: at, attempt: 2, error: "x" }) }, "b", later);
    expect(s.b).toMatchObject({ status: "skipped", endedAt: later, startedAt: at, attempt: 2, note: "المالك تخطّاها" });
    expect(s.b!.error).toBeUndefined();
  });

  it("the steps the owner switched off are named, never the trigger", () => {
    expect(disabledStepIds(chain(["a", "b", "c"], { b: { disabled: true }, c: { disabled: true } }))).toEqual(["b", "c"]);
    expect(disabledStepIds({ nodes: [{ id: "start", type: "trigger", label: "x", disabled: true }] })).toEqual([]);
  });
});
