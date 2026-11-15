import { describe, expect, it } from "vitest";
import { isValidCron } from "@/core/cron";
import { GraphSchema, SEED_WORKFLOWS, mergeNodeStates, settleStates, stepOrder, type WfGraph } from "@/core/workflow";

const g = (nodes: string[], edges: [string, string][]): WfGraph => ({ nodes: nodes.map((id) => ({ id, type: "step" as const, label: id })), edges: edges.map(([from, to]) => ({ from, to })) });

describe("the seeded jobs (v4 · E)", () => {
  it("are the owner's real jobs, each under its own key", () => {
    const keys = SEED_WORKFLOWS.map((w) => w.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of ["daily-check", "night-round", "product-tests", "video-collection", "shipments-check", "leak-plan", "manager-comment", "girls-training", "tinnitus-experiment", "one-off-verdicts", "team-round", "review-fixes", "hermes-requests", "basha-parcels", "breakeven-refresh"]) expect(keys, k).toContain(k);
  });

  it("run when the owner said they run (Amman clock)", () => {
    const at = (k: string) => SEED_WORKFLOWS.find((w) => w.key === k)!.schedule;
    expect(at("daily-check")).toBe("43 10 * * *");
    expect(at("night-round")).toBe("35 0 * * *");
    expect(at("product-tests")).toBe("17 0 * * *");
    expect(at("video-collection")).toBe("13 23 * * *");
    expect(at("shipments-check")).toBe("7 11-21/2 * * *");
    expect(at("leak-plan")).toBe("15 11 * * *");
    expect(at("manager-comment")).toBe("55 21 * * *");
    expect(at("girls-training")).toBe("20 11 * * 4");
    expect(at("team-round")).toBe("0 10-22 * * *");
  });

  it("all have a valid cron (or none), a valid graph with a trigger, and a permission on every step", () => {
    for (const w of SEED_WORKFLOWS) {
      if (w.schedule) expect(isValidCron(w.schedule), w.key).toBe(true);
      expect(GraphSchema.safeParse(w.graph).success, w.key).toBe(true);
      expect(w.graph.nodes.some((n) => n.type === "trigger"), w.key).toBe(true);
      for (const n of w.graph.nodes.filter((n) => n.type === "step")) expect(n.permission, `${w.key}/${n.id}`).toBeTruthy();
    }
  });

  it("show Claude (MCP) as the source of the numbers on the steps Claude does", () => {
    const night = SEED_WORKFLOWS.find((w) => w.key === "night-round")!;
    for (const n of night.graph.nodes.filter((n) => n.type === "step")) expect(n.executor).toBe("claude_mcp");
  });

  it("put the night round under a rule and a cap (yellow) and anything outside the rules behind the owner's yes (red)", () => {
    const night = SEED_WORKFLOWS.find((w) => w.key === "night-round")!;
    expect(night.permission).toBe("yellow");
    expect(night.graph.nodes.find((n) => n.type === "approval")!.permission).toBe("red");
  });

  it("hold no amount of money and no account — those are the owner's, typed in the app, never in this public repository", () => {
    const text = JSON.stringify(SEED_WORKFLOWS);
    expect(text).not.toMatch(/\$/);
    expect(text).not.toMatch(/\b850\b|\b60\b/);
    expect(text).not.toMatch(/act_\d/);
  });
});

describe("the graph", () => {
  it("is refused with a duplicate node or an edge into nothing", () => {
    expect(GraphSchema.safeParse(g(["a", "a"], [])).success).toBe(false);
    expect(GraphSchema.safeParse(g(["a"], [["a", "zzz"]])).success).toBe(false);
    expect(GraphSchema.safeParse(g(["a", "b"], [["a", "b"]])).success).toBe(true);
    expect(GraphSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
  });

  it("is put in the order it runs, keeping the drawn order for ties", () => {
    expect(stepOrder(g(["c", "a", "b"], [["a", "b"], ["b", "c"]])).map((n) => n.id)).toEqual(["a", "b", "c"]);
    expect(stepOrder(g(["x", "y", "z"], [["x", "z"]])).map((n) => n.id)).toEqual(["x", "y", "z"]);
  });

  it("does not hang on a loop", () => {
    expect(stepOrder(g(["a", "b"], [["a", "b"], ["b", "a"]])).map((n) => n.id).sort()).toEqual(["a", "b"]);
  });
});

describe("the live state of a run", () => {
  const graph = g(["start", "read", "judge", "done"], [["start", "read"], ["read", "judge"], ["judge", "done"]]);
  const at = "2026-11-14T21:40:00.000Z";
  const status = (s: ReturnType<typeof settleStates>) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.status]));

  it("merges what the caller reports and keeps the rest", () => {
    const s = mergeNodeStates({ start: { status: "done", at } }, [{ id: "read", status: "running", note: "عم يقرا" }, { id: "ghost", status: "done" }], at, new Set(["start", "read"]));
    expect(status(s)).toEqual({ start: "done", read: "running" });
    expect(s.read!.note).toBe("عم يقرا");
  });

  it("makes a run that only says «started» move: the trigger is done and the next node is running", () => {
    expect(status(settleStates(graph, {}, "running", at))).toEqual({ start: "done", read: "running" });
  });

  it("leaves a run that already reported its nodes alone", () => {
    const s = { start: { status: "done" as const, at }, read: { status: "running" as const, at } };
    expect(settleStates(graph, s, "running", at)).toEqual(s);
  });

  it("ends a successful run with every node done", () => {
    expect(status(settleStates(graph, { read: { status: "running", at } }, "ok", at))).toEqual({ start: "done", read: "done", judge: "done", done: "done" });
  });

  it("turns the running node red when a run fails — and the first unfinished one when nothing was running", () => {
    expect(status(settleStates(graph, { start: { status: "done", at }, read: { status: "running", at } }, "failed", at))).toEqual({ start: "done", read: "failed" });
    expect(status(settleStates(graph, { start: { status: "done", at } }, "failed", at))).toEqual({ start: "done", read: "failed" });
  });

  it("shows where a waiting run is stuck: an approval gate, or a handoff", () => {
    const withGate: WfGraph = { nodes: [{ id: "a", type: "step", label: "a" }, { id: "gate", type: "approval", label: "gate" }], edges: [{ from: "a", to: "gate" }] };
    expect(status(settleStates(withGate, { gate: { status: "running", at } }, "waiting", at)).gate).toBe("approval");
    expect(status(settleStates(graph, { read: { status: "running", at } }, "waiting", at)).read).toBe("handoff");
  });

  it("skips a disabled node", () => {
    const d: WfGraph = { nodes: [{ id: "a", type: "step", label: "a" }, { id: "b", type: "step", label: "b", disabled: true }], edges: [{ from: "a", to: "b" }] };
    expect(status(settleStates(d, {}, "ok", at))).toEqual({ a: "done" });
  });
});
