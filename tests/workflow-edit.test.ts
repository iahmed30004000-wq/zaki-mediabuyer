import { describe, expect, it } from "vitest";
import { GraphSchema, SEED_WORKFLOWS, type WfGraph, type WfNode } from "@/core/workflow";
import {
  GRID,
  MAX_NODES,
  NODE_H,
  NODE_W,
  WORKFLOW_TEMPLATES,
  addAfter,
  addNode,
  autoLayout,
  boundsOf,
  checkGraph,
  commitHistory,
  connect,
  descendants,
  diffText,
  disconnect,
  duplicateNode,
  edgeGeometry,
  ensureLayout,
  fitView,
  graphDiff,
  insertOnEdge,
  isChain,
  isPlaced,
  layersOf,
  moveInChain,
  moveNode,
  nextId,
  pushHistory,
  reaches,
  redoHistory,
  replaceGraph,
  removeNode,
  setNode,
  setPredecessor,
  snap,
  startHistory,
  templateOf,
  toWorld,
  undoHistory,
  zoomAt,
  type Edit,
} from "@/core/workflow-edit";

const node = (id: string, type: WfNode["type"] = "step", extra: Partial<WfNode> = {}): WfNode => ({ id, type, label: id, executor: "claude_mcp", permission: "green", ...extra });
const chain = (...ids: string[]): WfGraph => ({ nodes: ids.map((id, i) => node(id, i === 0 ? "trigger" : "step")), edges: ids.slice(1).map((id, i) => ({ from: ids[i]!, to: id })) });
const diamond = (): WfGraph => ({ nodes: [node("a", "trigger"), node("b"), node("c"), node("d")], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "b", to: "d" }, { from: "c", to: "d" }] });
const ok = (e: Edit) => {
  if (!e.ok) throw new Error(e.error);
  return e.graph;
};
const valid = (g: WfGraph) => GraphSchema.safeParse(g).success;
const overlap = (a: WfNode, b: WfNode) => a.x! < b.x! + NODE_W && b.x! < a.x! + NODE_W && a.y! < b.y! + NODE_H && b.y! < a.y! + NODE_H;

describe("how deep each step sits", () => {
  it("a line is 0, 1, 2…; a join is one below its deepest road", () => {
    expect([...layersOf(chain("a", "b", "c")).values()]).toEqual([0, 1, 2]);
    expect(layersOf(diamond()).get("d")).toBe(2);
    const long: WfGraph = { nodes: [node("a", "trigger"), node("b"), node("c"), node("d")], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "a", to: "d" }, { from: "c", to: "d" }] };
    expect(layersOf(long).get("d")).toBe(3);
  });

  it("a loop does not hang it: its nodes go below everything else", () => {
    const g: WfGraph = { nodes: [node("a", "trigger"), node("b"), node("c")], edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "b" }] };
    const d = layersOf(g);
    expect(d.get("a")).toBe(0);
    expect(d.get("b")).toBeGreaterThan(0);
    expect(d.get("c")).toBeGreaterThan(0);
  });
});

describe("autoLayout", () => {
  it("lays a line straight down, a whole number of grid cells apart", () => {
    const g = autoLayout(chain("a", "b", "c"));
    expect(new Set(g.nodes.map((n) => n.x)).size).toBe(1);
    expect(g.nodes.map((n) => n.y)).toEqual([32, 160, 288]);
    expect(g.nodes.every((n) => n.x! % GRID === 0 && n.y! % GRID === 0)).toBe(true);
  });

  it("spreads a branch sideways and puts the join under the middle of its roads", () => {
    const g = autoLayout(diamond());
    const at = (id: string) => g.nodes.find((n) => n.id === id)!;
    expect(at("b").y).toBe(at("c").y);
    expect(at("b").x).not.toBe(at("c").x);
    expect(at("d").x).toBe(snap((at("b").x! + at("c").x!) / 2));
    expect(at("a").x).toBe(at("d").x);
  });

  it("never lets two steps touch, on every seeded workflow", () => {
    for (const s of SEED_WORKFLOWS) {
      const g = autoLayout(s.graph);
      for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) expect(overlap(g.nodes[i]!, g.nodes[j]!), `${s.key}: ${g.nodes[i]!.id} / ${g.nodes[j]!.id}`).toBe(false);
      expect(valid(g)).toBe(true);
    }
  });

  it("is the same every time, keeps the lines, and starts at the corner", () => {
    const g = diamond();
    expect(autoLayout(g)).toEqual(autoLayout(g));
    expect(autoLayout(g).edges).toEqual(g.edges);
    const b = boundsOf(autoLayout(g));
    expect(b.x).toBe(GRID * 2);
    expect(b.y).toBe(GRID * 2);
  });

  it("a wide branch of three stays centred on the step above", () => {
    const g: WfGraph = { nodes: [node("a", "trigger"), node("b"), node("c"), node("d")], edges: [{ from: "a", to: "b" }, { from: "a", to: "c" }, { from: "a", to: "d" }] };
    const l = autoLayout(g);
    const xs = ["b", "c", "d"].map((id) => l.nodes.find((n) => n.id === id)!.x!);
    expect(xs[1]).toBe(l.nodes.find((n) => n.id === "a")!.x);
    expect(xs[0]).toBeLessThan(xs[1]!);
    expect(xs[2]).toBeGreaterThan(xs[1]!);
  });

  it("ensureLayout leaves a placed graph alone and places an unplaced one", () => {
    const placed = autoLayout(chain("a", "b"));
    expect(ensureLayout(placed)).toBe(placed);
    expect(isPlaced(chain("a", "b"))).toBe(false);
    expect(isPlaced(ensureLayout(chain("a", "b")))).toBe(true);
  });
});

describe("the view", () => {
  const g = autoLayout(diamond());
  it("fits the whole graph inside the box, centred, never bigger than life", () => {
    const b = boundsOf(g);
    const v = fitView(b, { w: 360, h: 640 });
    expect(b.w * v.k).toBeLessThanOrEqual(360);
    expect(b.h * v.k).toBeLessThanOrEqual(640);
    expect(v.k).toBeLessThanOrEqual(1);
    expect(Math.round(v.x + (b.x + b.w / 2) * v.k)).toBe(180);
    expect(Math.round(v.y + (b.y + b.h / 2) * v.k)).toBe(320);
    expect(fitView({ x: 0, y: 0, w: 50, h: 50 }, { w: 800, h: 600 }).k).toBe(1);
  });

  it("zooms around the finger: the point under it does not move", () => {
    const v0 = { x: 40, y: 20, k: 1 };
    const before = toWorld(v0, 200, 150);
    const v1 = zoomAt(v0, 1.6, 200, 150);
    const after = toWorld(v1, 200, 150);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(zoomAt(v0, 50, 0, 0).k).toBe(2);
    expect(zoomAt(v0, 0.01, 0, 0).k).toBe(0.3);
  });

  it("draws a line from the bottom middle of one step to the top middle of the next", () => {
    const e = edgeGeometry({ x: 0, y: 0 }, { x: 0, y: 128 });
    expect(e.d.startsWith(`M ${NODE_W / 2} ${NODE_H}`)).toBe(true);
    expect(e.d.endsWith(`${NODE_W / 2} 128`)).toBe(true);
    expect(e.mid).toEqual({ x: NODE_W / 2, y: (NODE_H + 128) / 2 });
  });
});

describe("adding and joining", () => {
  it("a new node gets a free id and lands under the lowest one", () => {
    const g = autoLayout(chain("a", "b"));
    const r = addNode(g, "step");
    expect(r.ok && r.id).toBe("step1");
    const next = ok(r);
    expect(next.nodes.at(-1)!.y).toBeGreaterThan(Math.max(...g.nodes.map((n) => n.y!)));
    expect(ok(addNode(next, "step")).nodes.at(-1)!.id).toBe("step2");
    expect(valid(next)).toBe(true);
  });

  it("each type starts with sensible fields — an approval gate is red", () => {
    const g = chain("a", "b");
    expect(ok(addNode(g, "approval")).nodes.at(-1)).toMatchObject({ type: "approval", permission: "red" });
    expect(ok(addNode(g, "trigger")).nodes.at(-1)).toMatchObject({ type: "trigger", executor: "system" });
    expect(ok(addNode(g, "notify")).nodes.at(-1)!.type).toBe("notify");
  });

  it("a graph is full at 60 steps", () => {
    const g: WfGraph = { nodes: Array.from({ length: MAX_NODES }, (_, i) => node(`n${i}`)), edges: [] };
    const r = addNode(g, "step");
    expect(r.ok).toBe(false);
  });

  it("joins two steps — and says why when it cannot", () => {
    const g = chain("a", "b", "c");
    expect(ok(connect(g, "a", "c")).edges).toHaveLength(3);
    const why = (from: string, to: string) => {
      const r = connect(g, from, to);
      return r.ok ? "" : r.error;
    };
    expect(why("a", "a")).toContain("بنفسها");
    expect(why("a", "b")).toContain("موجودة");
    expect(why("c", "a")).toContain("البداية");
    expect(why("c", "b")).toContain("دورة");
    expect(why("a", "zzz")).toContain("مش موجودة");
  });

  it("a line may carry a label (the road of a condition)", () => {
    const g: WfGraph = { nodes: [node("a", "trigger"), node("c", "condition"), node("x"), node("y")], edges: [{ from: "a", to: "c" }] };
    const g2 = ok(connect(g, "c", "x", "فوق التعادل"));
    expect(g2.edges.at(-1)).toEqual({ from: "c", to: "x", label: "فوق التعادل" });
  });

  it("takes a line away", () => {
    expect(disconnect(chain("a", "b"), "a", "b").edges).toEqual([]);
  });

  it("knows what a step reaches", () => {
    const g = diamond();
    expect([...descendants(g, "b")]).toEqual(["d"]);
    expect(reaches(g, "a", "d")).toBe(true);
    expect(reaches(g, "d", "a")).toBe(false);
  });
});

describe("a «+» on a line", () => {
  it("puts a joined step on it and pushes what is below down by one step", () => {
    const g = autoLayout(chain("a", "b", "c"));
    const r = insertOnEdge(g, { from: "a", to: "b" }, "approval");
    const next = ok(r);
    const at = (id: string) => next.nodes.find((n) => n.id === id)!;
    expect(r.ok && r.id).toBe("gate1");
    expect(next.edges).toContainEqual({ from: "a", to: "gate1" });
    expect(next.edges).toContainEqual({ from: "gate1", to: "b" });
    expect(next.edges.some((e) => e.from === "a" && e.to === "b")).toBe(false);
    expect(at("gate1").y).toBeGreaterThan(at("a").y!);
    expect(at("b").y).toBeGreaterThan(at("gate1").y!);
    expect(at("c").y).toBeGreaterThan(at("b").y!);
    expect(at("a").y).toBe(g.nodes[0]!.y);
    expect(valid(next)).toBe(true);
    for (let i = 0; i < next.nodes.length; i++) for (let j = i + 1; j < next.nodes.length; j++) expect(overlap(next.nodes[i]!, next.nodes[j]!)).toBe(false);
  });

  it("keeps the label of the line it splits, and refuses a line that is not there", () => {
    const g: WfGraph = { nodes: [node("a", "trigger"), node("b")], edges: [{ from: "a", to: "b", label: "نعم" }] };
    expect(ok(insertOnEdge(g, { from: "a", to: "b" }, "step")).edges).toContainEqual({ from: "a", to: "step1", label: "نعم" });
    expect(insertOnEdge(g, { from: "b", to: "a" }, "step").ok).toBe(false);
    expect(insertOnEdge(g, { from: "a", to: "b" }, "trigger").ok).toBe(false);
  });
});

describe("taking a step out", () => {
  it("a step in a line leaves the line closed", () => {
    const next = ok(removeNode(chain("a", "b", "c"), "b"));
    expect(next.nodes.map((n) => n.id)).toEqual(["a", "c"]);
    expect(next.edges).toEqual([{ from: "a", to: "c" }]);
  });

  it("a step with several roads in or out just takes its lines away", () => {
    const next = ok(removeNode(diamond(), "b"));
    expect(next.edges).toEqual([{ from: "a", to: "c" }, { from: "c", to: "d" }]);
    const fork = ok(removeNode(diamond(), "a"));
    expect(fork.edges).toEqual([{ from: "b", to: "d" }, { from: "c", to: "d" }]);
  });

  it("the last step cannot go, and an unknown one is said", () => {
    expect(removeNode({ nodes: [node("a")], edges: [] }, "a").ok).toBe(false);
    expect(removeNode(chain("a", "b"), "zzz").ok).toBe(false);
  });
});

describe("copying and editing a step", () => {
  it("a copy sits next to it, with a new id, not joined to anything", () => {
    const g = autoLayout(chain("a", "b"));
    const r = duplicateNode(g, "b");
    const next = ok(r);
    const copy = next.nodes.find((n) => n.id === (r.ok ? r.id : ""))!;
    expect(copy.label).toBe("b (نسخة)");
    expect(copy.id).not.toBe("b");
    expect(next.edges).toEqual(g.edges);
    expect(copy.x).not.toBe(g.nodes[1]!.x);
    expect(valid(next)).toBe(true);
  });

  it("edits fields; an emptied one is removed; the id never changes", () => {
    const g = chain("a", "b");
    const g2 = ok(setNode(g, "b", { label: "اسم جديد", prompt: "اقرا {{product}}", timeoutS: 300, id: "hacked" as never }));
    const b = g2.nodes.find((n) => n.id === "b")!;
    expect(b).toMatchObject({ label: "اسم جديد", prompt: "اقرا {{product}}", timeoutS: 300 });
    expect(g2.nodes.some((n) => n.id === "hacked")).toBe(false);
    const g3 = ok(setNode(g2, "b", { prompt: "" }));
    expect("prompt" in g3.nodes.find((n) => n.id === "b")!).toBe(false);
  });

  it("refuses what the schema refuses, in words", () => {
    const g = chain("a", "b");
    expect(setNode(g, "b", { label: "" }).ok).toBe(false);
    expect(setNode(g, "b", { retries: 99 }).ok).toBe(false);
    expect(setNode(g, "zzz", { label: "x" }).ok).toBe(false);
  });

  it("moves a node on the grid", () => {
    const g = moveNode(autoLayout(chain("a", "b")), "b", 101, 203);
    expect(g.nodes[1]).toMatchObject({ x: 96, y: 208 });
  });

  it("«بعد: …» makes one step the only thing flowing into another", () => {
    const g = chain("a", "b", "c");
    const g2 = ok(setPredecessor(g, "c", "a"));
    expect(g2.edges.filter((e) => e.to === "c")).toEqual([{ from: "a", to: "c" }]);
    expect(ok(setPredecessor(g, "c", null)).edges.some((e) => e.to === "c")).toBe(false);
    expect(setPredecessor(g, "b", "c").ok).toBe(false);
  });

  it("finds the next free id", () => {
    expect(nextId(chain("step1", "step2"), "step")).toBe("step3");
    expect(nextId(chain("a", "b"), "الخطوة")).toBe("node1");
  });
});

describe("the steps list", () => {
  it("knows a straight line and moves a step up or down it", () => {
    const g = chain("a", "b", "c", "d");
    expect(isChain(g)).toBe(true);
    const moved = ok(moveInChain(g, "d", -1));
    expect(moved.edges).toEqual([{ from: "a", to: "b" }, { from: "b", to: "d" }, { from: "d", to: "c" }]);
    expect(moveInChain(g, "b", -1).ok).toBe(false);
    expect(moveInChain(g, "d", 1).ok).toBe(false);
  });

  it("a branch, a join or a labelled line is not a line — it is edited on the canvas", () => {
    expect(isChain(diamond())).toBe(false);
    expect(isChain({ nodes: [node("a", "trigger"), node("b")], edges: [{ from: "a", to: "b", label: "x" }] })).toBe(false);
    expect(moveInChain(diamond(), "b", 1).ok).toBe(false);
  });
});

describe("what a version changed", () => {
  it("counts steps, edits, lines and moves — and says it in a line", () => {
    const a = autoLayout(chain("a", "b", "c"));
    const b0 = ok(setNode(a, "b", { label: "غيّرت الاسم" }));
    const b1 = ok(addNode(b0, "notify"));
    const b2 = ok(connect(b1, "c", "notify1"));
    const b3 = moveNode(b2, "a", 400, 400);
    const d = graphDiff(a, b3);
    expect(d).toMatchObject({ addedNodes: ["notify1"], removedNodes: [], changedNodes: ["b"], addedEdges: 1, removedEdges: 0, movedNodes: 1 });
    expect(diffText(d)).toBe("+1 خطوة · 1 تعديل · +1 وصلة · 1 تحريك");
  });

  it("the same graph is «بلا تغيير»; a removed step and line are counted", () => {
    const a = chain("a", "b", "c");
    expect(diffText(graphDiff(a, a))).toBe("بلا تغيير");
    expect(diffText(graphDiff(a, ok(removeNode(a, "b"))))).toBe("−1 خطوة · +1 وصلة · −2 وصلة");
  });
});

describe("checking a graph before a save", () => {
  it("is quiet about a good one", () => {
    expect(checkGraph(chain("a", "b", "c"))).toEqual([]);
  });

  it("warns, in words, about what is odd", () => {
    const g: WfGraph = {
      nodes: [node("a", "trigger"), node("c", "condition", { label: "الشرط" }), node("x"), node("lonely", "step", { label: "وحيدة" }), node("gate", "approval", { label: "بوابة", permission: "green" }), node("k", "step", { label: "ممنوعة", permission: "black" })],
      edges: [{ from: "a", to: "c" }, { from: "c", to: "x" }, { from: "x", to: "gate" }, { from: "gate", to: "k" }],
    };
    const texts = checkGraph(g).map((i) => i.text);
    expect(texts.some((t) => t.includes("وحيدة") && t.includes("مش موصولة"))).toBe(true);
    expect(texts.some((t) => t.includes("الشرط") && t.includes("مسارين"))).toBe(true);
    expect(texts.some((t) => t.includes("بوابة") && t.includes("حمرا"))).toBe(true);
    expect(texts.some((t) => t.includes("ممنوعة") && t.includes("أسود"))).toBe(true);
    expect(checkGraph(g).every((i) => i.level === "warn")).toBe(true);
  });

  it("no start is a warning; a broken graph is an error", () => {
    expect(checkGraph({ nodes: [node("a"), node("b")], edges: [{ from: "a", to: "b" }] })[0]!.text).toContain("بداية");
    const bad = { nodes: [node("a")], edges: [{ from: "a", to: "ghost" }] } as WfGraph;
    expect(checkGraph(bad).some((i) => i.level === "error")).toBe(true);
  });
});

describe("a new workflow", () => {
  it("every template is a valid graph with a start, and its ids are its own", () => {
    expect(WORKFLOW_TEMPLATES.map((t) => t.id)).toEqual(["blank", "daily", "approval", "person"]);
    for (const t of WORKFLOW_TEMPLATES) {
      expect(valid(t.graph), t.id).toBe(true);
      expect(t.graph.nodes.some((n) => n.type === "trigger"), t.id).toBe(true);
      expect(checkGraph(t.graph).filter((i) => i.level === "error"), t.id).toEqual([]);
      expect(isPlaced(autoLayout(t.graph))).toBe(true);
    }
    expect(templateOf("approval")!.graph.nodes.find((n) => n.type === "approval")!.permission).toBe("red");
    expect(templateOf("nope")).toBeUndefined();
  });

  it("no template carries an amount of money", () => {
    expect(JSON.stringify(WORKFLOW_TEMPLATES)).not.toMatch(/\$|\d+\s*دولار/);
  });
});

describe("undo and redo", () => {
  const a = chain("a", "b");
  const b = ok(addNode(a, "step"));
  const c = ok(addNode(b, "notify"));

  it("goes back and forth along the steps", () => {
    let h = pushHistory(pushHistory(startHistory(a), b), c);
    expect(h.graph).toBe(c);
    h = undoHistory(h);
    expect(h.graph).toBe(b);
    h = undoHistory(undoHistory(h));
    expect(h.graph).toBe(a);
    expect(undoHistory(h)).toBe(h);
    h = redoHistory(h);
    expect(h.graph).toBe(b);
    expect(redoHistory(redoHistory(redoHistory(h))).graph).toBe(c);
  });

  it("a new change after an undo throws the redo steps away; the same drawing is no step", () => {
    let h = undoHistory(pushHistory(startHistory(a), b));
    h = pushHistory(h, c);
    expect(h.future).toEqual([]);
    expect(pushHistory(h, h.graph)).toBe(h);
  });

  it("a drag moves the drawing without steps and makes ONE step at its end", () => {
    const h0 = startHistory(a);
    const moving = moveNode(a, "b", 200, 200);
    const h1 = replaceGraph(replaceGraph(h0, moveNode(a, "b", 100, 100)), moving);
    expect(h1.past).toEqual([]);
    const h2 = commitHistory(h1, a, moving);
    expect(h2.past).toEqual([a]);
    expect(undoHistory(h2).graph).toBe(a);
    expect(commitHistory(h1, moving, moving).past).toEqual([]);
  });

  it("keeps only the last 50 steps", () => {
    let h = startHistory(a);
    for (let i = 0; i < 80; i++) h = pushHistory(h, moveNode(h.graph, "b", i * 16, 0));
    expect(h.past).toHaveLength(50);
  });
});

describe("a step right after another", () => {
  it("goes on the only road the step has — inserted, and what is below moves down", () => {
    const g = autoLayout(chain("a", "b", "c"));
    const r = addAfter(g, "a", "step");
    const next = ok(r);
    expect(next.edges).toContainEqual({ from: "a", to: "step1" });
    expect(next.edges).toContainEqual({ from: "step1", to: "b" });
    expect(next.nodes.find((n) => n.id === "c")!.y).toBeGreaterThan(g.nodes[2]!.y!);
  });

  it("at the end of a line it hangs under the last step, joined to it", () => {
    const g = autoLayout(chain("a", "b"));
    const next = ok(addAfter(g, "b", "notify"));
    expect(next.edges).toContainEqual({ from: "b", to: "notify1" });
    const added = next.nodes.find((n) => n.id === "notify1")!;
    expect(added.y).toBeGreaterThan(g.nodes[1]!.y!);
    expect(added.x).toBe(g.nodes[1]!.x);
  });

  it("slides sideways when the place under it is taken, and never lands on another step", () => {
    const g = autoLayout(diamond());
    const next = ok(addAfter(g, "a", "step"));
    for (let i = 0; i < next.nodes.length; i++) for (let j = i + 1; j < next.nodes.length; j++) expect(overlap(next.nodes[i]!, next.nodes[j]!)).toBe(false);
    expect(valid(next)).toBe(true);
  });

  it("a start is placed, not joined; an unknown anchor is said", () => {
    const g = autoLayout(chain("a", "b"));
    expect(ok(addAfter(g, "b", "trigger")).edges).toEqual(g.edges);
    expect(addAfter(g, "zzz", "step").ok).toBe(false);
  });
});
