import { describe, expect, it } from "vitest";
import { GraphSchema, type NodeStates, type WfGraph } from "@/core/workflow";
import { autoLayout } from "@/core/workflow-edit";
import { miniMap, promptVars, replayAt, replayCaption, replayEvents, tryPrompt, viewAtMapPoint } from "@/core/workflow-replay";

const node = (id: string, type: "trigger" | "step" | "condition" = "step", extra: Record<string, unknown> = {}) => ({ id, type, label: `خطوة ${id}`, ...extra });
// a → b → c, and b → d (a branch that may not run)
const graph: WfGraph = GraphSchema.parse({
  nodes: [node("a", "trigger"), node("b"), node("c"), node("d")],
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "b", to: "d" },
  ],
});
const T = (s: number) => `2026-11-15T10:00:${String(s).padStart(2, "0")}.000Z`;

describe("replay of a run", () => {
  const states: NodeStates = {
    c: { status: "failed", at: T(30), note: "انقطع الاتصال" },
    a: { status: "done", at: T(1) },
    b: { status: "done", at: T(10) },
  };

  it("lays the steps out in the order they reported", () => {
    const { events, unknown } = replayEvents(graph, states);
    expect(events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(unknown).toBe(0);
    expect(events[2]).toMatchObject({ status: "failed", note: "انقطع الاتصال" });
  });

  it("states of steps this drawing does not have are counted, not shown", () => {
    const { events, unknown } = replayEvents(graph, { ...states, gone: { status: "done", at: T(5) } });
    expect(events.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(unknown).toBe(1);
  });

  it("frame 0 has the first step working; each frame after puts one more step to its last state", () => {
    const { events } = replayEvents(graph, states);
    expect(replayAt(graph, events, 0)).toEqual({ a: { status: "running", at: T(1) } });
    const f1 = replayAt(graph, events, 1);
    expect(f1.a).toMatchObject({ status: "done" });
    expect(f1.b).toMatchObject({ status: "running" });
    expect(f1.c).toBeUndefined();
    const f2 = replayAt(graph, events, 2);
    expect(f2.b).toMatchObject({ status: "done" });
    // c reported later, so it is working; d never reported, so it is not drawn as anything
    expect(f2.c).toMatchObject({ status: "running" });
    expect(f2.d).toBeUndefined();
    const f3 = replayAt(graph, events, 3);
    expect(f3.c).toMatchObject({ status: "failed", note: "انقطع الاتصال" });
  });

  it("the last frame is exactly the run's own states", () => {
    const { events } = replayEvents(graph, states);
    expect(replayAt(graph, events, events.length)).toEqual(states);
    expect(replayAt(graph, events, 999)).toEqual(states);
    expect(replayAt(graph, events, -4)).toEqual(replayAt(graph, events, 0));
  });

  it("a step after one that did not finish is never drawn as working", () => {
    const failedAtB: NodeStates = { a: { status: "done", at: T(1) }, b: { status: "failed", at: T(5) }, c: { status: "done", at: T(9) } };
    const { events } = replayEvents(graph, failedAtB);
    // c reported 'done' although b failed (a caller's choice): until its own frame it must not show as working
    expect(replayAt(graph, events, 2).c).toBeUndefined();
  });

  it("a run that marked every step at one instant still plays in the drawing's order", () => {
    const at = T(7);
    const all: NodeStates = { c: { status: "done", at }, d: { status: "done", at }, b: { status: "done", at }, a: { status: "done", at } };
    const { events } = replayEvents(graph, all);
    expect(events.map((e) => e.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("a time that does not read goes last; a step that was switched off is not inferred as working", () => {
    const odd: NodeStates = { a: { status: "done", at: "غلط" }, b: { status: "done", at: T(2) } };
    expect(replayEvents(graph, odd).events.map((e) => e.id)).toEqual(["b", "a"]);
    const off = GraphSchema.parse({ nodes: [node("a", "trigger"), node("b", "step", { disabled: true })], edges: [{ from: "a", to: "b" }] });
    const { events } = replayEvents(off, { a: { status: "done", at: T(1) }, b: { status: "done", at: T(2) } });
    expect(replayAt(off, events, 1).b).toBeUndefined();
  });

  it("captions say what happened, in words", () => {
    const { events } = replayEvents(graph, states);
    expect(replayCaption(events, 0)).toBe("بداية التشغيل");
    expect(replayCaption(events, 3)).toBe("خطوة c — فشلت");
    expect(replayCaption([], 0)).toContain("ما في خطوات");
  });
});

describe("minimap", () => {
  const placed = autoLayout(graph);
  const box = { w: 600, h: 400 };

  it("draws every placed step, and the window the board shows", () => {
    const m = miniMap(placed, { x: 0, y: 0, k: 1 }, box);
    expect(m.boxes.map((b) => b.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(m.w).toBeLessThanOrEqual(160.001);
    expect(m.h).toBeLessThanOrEqual(110.001);
    expect(m.viewport.w).toBeGreaterThan(0);
    // every box sits inside the map
    for (const b of m.boxes) {
      expect(b.x).toBeGreaterThanOrEqual(-0.001);
      expect(b.x + b.w).toBeLessThanOrEqual(m.w + 0.001);
    }
  });

  it("zooming in shrinks the window", () => {
    const a = miniMap(placed, { x: 0, y: 0, k: 1 }, box);
    const b = miniMap(placed, { x: 0, y: 0, k: 2 }, box);
    expect(b.viewport.w * (a.scale / b.scale)).toBeLessThan(a.viewport.w);
  });

  it("a tap on the map centres the board there, keeping the zoom", () => {
    const view = { x: 10, y: 20, k: 1.5 };
    const m = miniMap(placed, view, box);
    const v = viewAtMapPoint(m, m.w / 2, m.h / 2, view, box);
    expect(v.k).toBe(1.5);
    // the world point under the tap is now at the middle of the board
    const wx = m.origin.x + m.w / 2 / m.scale;
    expect(v.x + wx * v.k).toBeCloseTo(box.w / 2, 5);
    const wy = m.origin.y + m.h / 2 / m.scale;
    expect(v.y + wy * v.k).toBeCloseTo(box.h / 2, 5);
  });
});

describe("trying a step's words", () => {
  const text = "اقرا أرقام {{product}} ليوم {{day}} وقارنها مع {{product}} الأسبوع الماضي.";

  it("finds the variables once each, in order", () => {
    expect(promptVars(text)).toEqual(["product", "day"]);
    expect(promptVars("بلا متغيّرات")).toEqual([]);
    expect(promptVars("{{ المنتج }} و{{ x }}")).toEqual(["المنتج", "x"]);
  });

  it("puts values in everywhere and says what is still missing", () => {
    const t = tryPrompt(text, { product: "الطنين" });
    expect(t.text).toBe("اقرا أرقام الطنين ليوم {{day}} وقارنها مع الطنين الأسبوع الماضي.");
    expect(t.missing).toEqual(["day"]);
    expect(t.refused).toEqual([]);
    const full = tryPrompt(text, { product: "الطنين", day: "امبارح" });
    expect(full.missing).toEqual([]);
    expect(full.text).not.toContain("{{");
  });

  it("an empty value counts as missing", () => {
    expect(tryPrompt(text, { product: "  ", day: "" }).missing).toEqual(["product", "day"]);
  });

  it("a phone number, an e-mail or a key is refused and not put in", () => {
    const t = tryPrompt(text, { product: "0791234567", day: "a@b.com" });
    expect(t.refused.map((r) => r.name)).toEqual(["product", "day"]);
    expect(t.text).toContain("{{product}}");
    expect(t.text).not.toContain("0791234567");
    expect(t.missing).toEqual(["product", "day"]);
  });

  it("values are cut at 200 characters and a replacement never re-reads itself", () => {
    const t = tryPrompt("x {{a}} y", { a: "{{a}}" + "z".repeat(300) });
    expect(t.text.length).toBeLessThan(260);
    expect(t.text.startsWith("x {{a}}")).toBe(true);
    expect(t.length).toBe(t.text.length);
  });
});
