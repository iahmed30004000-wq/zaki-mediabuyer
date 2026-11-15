/**
 * EDITING A WORKFLOW (v3 · F), pure: every change the canvas and the steps list make to a graph, as a function that returns
 * a NEW graph (or says in words why it cannot) — so the screen only draws, and every rule is tested here.
 *
 *   layout     steps flow top to bottom (it reads the same in Arabic and in English, and on a phone); a branch spreads sideways
 *   connect    no loop, no twin line, nothing flows INTO a trigger, never a line from a step to itself
 *   insert     a «+» on a line puts a new step on it, already joined, and pushes what is below it down
 *   remove     a step in a straight line leaves the line closed (what was before it joins what was after it)
 *   diff       what changed between two versions, in words, for the version's note
 *
 * Nothing here talks to a database. The graph stays valid for `GraphSchema` after every function that returns `ok`.
 */
import { EXECUTORS, GraphSchema, NodeSchema, stepOrder, type Executor, type NodeType, type WfEdge, type WfGraph, type WfNode } from "./workflow";

export const GRID = 16;
export const NODE_W = 176;
export const NODE_H = 68;
const COL_GAP = 48;
const ROW_GAP = 60;
export const MAX_NODES = 60;
export const MAX_EDGES = 120;

export const snap = (v: number, g = GRID): number => Math.round(v / g) * g;

export type Edit = { ok: true; graph: WfGraph; id?: string } | { ok: false; error: string };
const fail = (error: string): Edit => ({ ok: false, error });
const done = (graph: WfGraph, id?: string): Edit => ({ ok: true, graph, ...(id ? { id } : {}) });

// ───────────────────────────── reading a graph ─────────────────────────────

const outOf = (g: WfGraph) => {
  const m = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) m.get(e.from)?.push(e.to);
  return m;
};
const into = (g: WfGraph) => {
  const m = new Map<string, string[]>(g.nodes.map((n) => [n.id, []]));
  for (const e of g.edges) m.get(e.to)?.push(e.from);
  return m;
};

/** Everything reachable from `id` by following lines (not `id` itself, unless a loop brings it back). */
export function descendants(g: WfGraph, id: string): Set<string> {
  const out = outOf(g);
  const seen = new Set<string>();
  const stack = [...(out.get(id) ?? [])];
  while (stack.length) {
    const n = stack.pop()!;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(out.get(n) ?? []));
  }
  return seen;
}

/** True when `from` can reach `to` following the lines (so a line `to → from` would close a loop). */
export const reaches = (g: WfGraph, from: string, to: string): boolean => from === to || descendants(g, from).has(to);

/** How deep each node sits: 0 for the ones nothing flows into, one more than its deepest predecessor after that. Nodes in a loop go last. */
export function layersOf(g: WfGraph): Map<string, number> {
  const out = outOf(g);
  const left = new Map(g.nodes.map((n) => [n.id, 0]));
  for (const e of g.edges) left.set(e.to, (left.get(e.to) ?? 0) + 1);
  const depth = new Map<string, number>();
  const queue = g.nodes.filter((n) => (left.get(n.id) ?? 0) === 0).map((n) => n.id);
  for (const id of queue) depth.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    for (const to of out.get(id) ?? []) {
      depth.set(to, Math.max(depth.get(to) ?? 0, (depth.get(id) ?? 0) + 1));
      left.set(to, (left.get(to) ?? 1) - 1);
      if (left.get(to) === 0) queue.push(to);
    }
  }
  const deepest = Math.max(-1, ...depth.values());
  for (const n of g.nodes) if (!depth.has(n.id)) depth.set(n.id, deepest + 1);
  return depth;
}

// ───────────────────────────── layout ─────────────────────────────

const hasPlace = (n: WfNode) => typeof n.x === "number" && typeof n.y === "number";
export const isPlaced = (g: WfGraph): boolean => g.nodes.every(hasPlace);

/**
 * Lays the graph out in layers, top to bottom. Inside a layer a node sits under the middle of what flows into it, nodes
 * keep their drawn order when nothing says otherwise, and two never touch. Same graph → same layout, every time.
 */
export function autoLayout(g: WfGraph): WfGraph {
  const depth = layersOf(g);
  const order = new Map(stepOrder(g).map((n, i) => [n.id, i]));
  const preds = into(g);
  const rows = new Map<number, WfNode[]>();
  for (const n of g.nodes) rows.set(depth.get(n.id)!, [...(rows.get(depth.get(n.id)!) ?? []), n]);
  const at = new Map<string, number>();
  const step = NODE_W + COL_GAP;
  for (const layer of [...rows.keys()].sort((a, b) => a - b)) {
    const nodes = rows.get(layer)!;
    const want = (n: WfNode) => {
      const xs = (preds.get(n.id) ?? []).map((p) => at.get(p)).filter((v): v is number => v !== undefined);
      return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;
    };
    const wanted = nodes.map((n) => ({ n, w: want(n) }));
    // the ones with something above them sit under it; the others keep the drawn order, to its right
    wanted.sort((a, b) => (a.w ?? Infinity) - (b.w ?? Infinity) || order.get(a.n.id)! - order.get(b.n.id)!);
    const xs = wanted.map(({ w }, i) => (w ?? i * step));
    for (let i = 1; i < xs.length; i++) xs[i] = Math.max(xs[i]!, xs[i - 1]! + step);
    const shift = (wanted.reduce((s, { w }, i) => s + (w ?? xs[i]!), 0) - xs.reduce((s, v) => s + v, 0)) / wanted.length;
    wanted.forEach(({ n }, i) => at.set(n.id, xs[i]! + shift));
  }
  const minX = Math.min(...at.values());
  return {
    ...g,
    nodes: g.nodes.map((n) => ({ ...n, x: snap(at.get(n.id)! - minX + GRID * 2), y: snap(depth.get(n.id)! * (NODE_H + ROW_GAP) + GRID * 2) })),
  };
}

/** A graph every node of which has a place: the one it has, or — when any is missing — a fresh layout. */
export const ensureLayout = (g: WfGraph): WfGraph => (isPlaced(g) ? g : autoLayout(g));

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function boundsOf(g: WfGraph): Bounds {
  const placed = g.nodes.filter(hasPlace);
  if (!placed.length) return { x: 0, y: 0, w: NODE_W, h: NODE_H };
  const x1 = Math.min(...placed.map((n) => n.x!));
  const y1 = Math.min(...placed.map((n) => n.y!));
  const x2 = Math.max(...placed.map((n) => n.x! + NODE_W));
  const y2 = Math.max(...placed.map((n) => n.y! + NODE_H));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

export interface View {
  /** where the world's origin sits on the screen, in px */
  x: number;
  y: number;
  /** zoom */
  k: number;
}
export const MIN_ZOOM = 0.3;
export const MAX_ZOOM = 2;
const clampZoom = (k: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, k));

/** The view that shows the whole graph in a box, centred, never bigger than life. */
export function fitView(b: Bounds, box: { w: number; h: number }, pad = 24): View {
  const k = clampZoom(Math.min((box.w - pad * 2) / b.w, (box.h - pad * 2) / b.h, 1));
  return { k, x: (box.w - b.w * k) / 2 - b.x * k, y: (box.h - b.h * k) / 2 - b.y * k };
}

/** Zooms to `k2` keeping the point (px, py) of the screen where it is — the way a pinch or a wheel feels. */
export function zoomAt(v: View, k2: number, px: number, py: number): View {
  const k = clampZoom(k2);
  const wx = (px - v.x) / v.k;
  const wy = (py - v.y) / v.k;
  return { k, x: px - wx * k, y: py - wy * k };
}

export const toWorld = (v: View, px: number, py: number) => ({ x: (px - v.x) / v.k, y: (py - v.y) / v.k });

/** The line between two nodes (the bottom middle of one to the top middle of the next) as a curve, and its middle. */
export function edgeGeometry(a: { x: number; y: number }, b: { x: number; y: number }): { d: string; mid: { x: number; y: number } } {
  const x1 = a.x + NODE_W / 2;
  const y1 = a.y + NODE_H;
  const x2 = b.x + NODE_W / 2;
  const y2 = b.y;
  const dy = Math.min(120, Math.max(32, Math.abs(y2 - y1) / 2));
  const c1y = y1 + dy;
  const c2y = y2 - dy;
  const r = (n: number) => Math.round(n * 10) / 10;
  return {
    d: `M ${r(x1)} ${r(y1)} C ${r(x1)} ${r(c1y)}, ${r(x2)} ${r(c2y)}, ${r(x2)} ${r(y2)}`,
    mid: { x: r((x1 + 3 * x1 + 3 * x2 + x2) / 8), y: r((y1 + 3 * c1y + 3 * c2y + y2) / 8) },
  };
}

// ───────────────────────────── changing a graph ─────────────────────────────

/** The next free id with this base: «step1», «step2»… (ids are letters, digits, _ and -). */
export function nextId(g: WfGraph, base: string): string {
  const taken = new Set(g.nodes.map((n) => n.id));
  const clean = base.replace(/[^A-Za-z0-9_-]/g, "").replace(/\d+$/, "") || "node";
  for (let i = 1; i < 1000; i++) if (!taken.has(`${clean}${i}`)) return `${clean}${i}`;
  return `${clean}${Date.now()}`;
}

export const TYPE_AR: Record<NodeType, string> = { trigger: "بداية", step: "خطوة", condition: "شرط", approval: "موافقة المالك", wait: "انتظار", notify: "تبليغ" };

const DEFAULTS: Record<NodeType, Omit<WfNode, "id" | "type">> = {
  trigger: { label: "بداية جديدة", executor: "system", permission: "green" },
  step: { label: "خطوة جديدة", executor: "claude_mcp", dataSource: "mcp", permission: "green" },
  condition: { label: "شرط: إذا… وإلا", executor: "claude_mcp", permission: "green" },
  approval: { label: "موافقة المالك", executor: "claude_mcp", permission: "red", destination: "الميديا باير ← المهام ← بانتظار موافقتك" },
  wait: { label: "انتظار", executor: "system", permission: "green" },
  notify: { label: "تبليغ المالك", executor: "claude_mcp", permission: "green" },
};

export const NODE_PREFIX: Record<NodeType, string> = { trigger: "start", step: "step", condition: "cond", approval: "gate", wait: "wait", notify: "notify" };

/** A new node of this type, placed at (x, y) when given, else under the lowest one. Not joined to anything yet. */
export function addNode(g: WfGraph, type: NodeType, at?: { x: number; y: number }): Edit {
  if (g.nodes.length >= MAX_NODES) return fail(`حد أقصى ${MAX_NODES} خطوة بالورك فلو الواحد`);
  const id = nextId(g, NODE_PREFIX[type]);
  const placed = g.nodes.filter(hasPlace);
  const lowest = placed.length ? Math.max(...placed.map((n) => n.y!)) + NODE_H + ROW_GAP : GRID * 2;
  const centre = placed.length ? placed.reduce((s, n) => s + n.x!, 0) / placed.length : GRID * 2;
  const node: WfNode = { id, type, ...DEFAULTS[type], x: snap(at?.x ?? centre), y: snap(at?.y ?? lowest) };
  return done({ ...g, nodes: [...g.nodes, node] }, id);
}

const overlaps = (a: WfNode, b: WfNode) => a.x! < b.x! + NODE_W + GRID && b.x! < a.x! + NODE_W + GRID && a.y! < b.y! + NODE_H + GRID && b.y! < a.y! + NODE_H + GRID;

/**
 * A new node right AFTER `anchor`: on its only road when it has one (inserted there, and what is below moves down), else under
 * it, slid sideways to the first free place — and joined to it. A start has nothing before it, so it is only placed.
 */
export function addAfter(g: WfGraph, anchorId: string, type: NodeType): Edit {
  const a = g.nodes.find((n) => n.id === anchorId);
  if (!a) return fail("الخطوة مش موجودة");
  const outs = g.edges.filter((e) => e.from === anchorId);
  if (type !== "trigger" && outs.length === 1) return insertOnEdge(g, outs[0]!, type);
  const r = addNode(g, type, hasPlace(a) ? { x: a.x!, y: a.y! + NODE_H + ROW_GAP } : undefined);
  if (!r.ok) return r;
  let next = r.graph;
  const id = r.id!;
  for (let i = 0; i < 24; i++) {
    const n = next.nodes.find((x) => x.id === id)!;
    if (!next.nodes.some((o) => o.id !== id && hasPlace(o) && hasPlace(n) && overlaps(o, n))) break;
    next = moveNode(next, id, n.x! + NODE_W + COL_GAP, n.y!);
  }
  if (type === "trigger") return done(next, id);
  const c = connect(next, anchorId, id);
  return c.ok ? done(c.graph, id) : c;
}

/** Joins `from` to `to`. Why not, in words, when it cannot be. */
export function connect(g: WfGraph, from: string, to: string, label?: string): Edit {
  const a = g.nodes.find((n) => n.id === from);
  const b = g.nodes.find((n) => n.id === to);
  if (!a || !b) return fail("الخطوة مش موجودة");
  if (from === to) return fail("ما بتنوصل الخطوة بنفسها");
  if (b.type === "trigger") return fail("ما شي بيدخل على البداية — هي اللي بتبدأ الشغل");
  if (g.edges.some((e) => e.from === from && e.to === to)) return fail("هالوصلة موجودة");
  if (g.edges.length >= MAX_EDGES) return fail(`حد أقصى ${MAX_EDGES} وصلة`);
  if (reaches(g, to, from)) return fail("هالوصلة بتعمل دورة — الخطوة بتصير تستنى حالها");
  return done({ ...g, edges: [...g.edges, { from, to, ...(label ? { label: label.slice(0, 60) } : {}) }] });
}

export const disconnect = (g: WfGraph, from: string, to: string): WfGraph => ({ ...g, edges: g.edges.filter((e) => !(e.from === from && e.to === to)) });

/** Puts a new node on a line: from → NEW → to. What is below the line moves down to make room. */
export function insertOnEdge(g: WfGraph, edge: Pick<WfEdge, "from" | "to">, type: NodeType): Edit {
  const line = g.edges.find((e) => e.from === edge.from && e.to === edge.to);
  const a = g.nodes.find((n) => n.id === edge.from);
  const b = g.nodes.find((n) => n.id === edge.to);
  if (!line || !a || !b) return fail("الوصلة مش موجودة");
  if (type === "trigger") return fail("البداية ما بتنحط جوّا الخط");
  if (g.nodes.length >= MAX_NODES) return fail(`حد أقصى ${MAX_NODES} خطوة بالورك فلو الواحد`);
  const id = nextId(g, NODE_PREFIX[type]);
  const room = NODE_H + ROW_GAP;
  const below = descendants(g, edge.to);
  below.add(edge.to);
  const moved = g.nodes.map((n) => (below.has(n.id) && n.id !== edge.from && hasPlace(n) ? { ...n, y: n.y! + room } : n));
  const node: WfNode = { id, type, ...DEFAULTS[type], x: snap(hasPlace(a) ? a.x! : GRID * 2), y: snap(hasPlace(a) ? a.y! + room : GRID * 2) };
  const edges = g.edges.filter((e) => e !== line).concat([{ from: edge.from, to: id, ...(line.label ? { label: line.label } : {}) }, { from: id, to: edge.to }]);
  return done({ nodes: [...moved, node], edges }, id);
}

/** Takes a node out. A node in a straight line leaves the line closed: what was before it joins what was after it. */
export function removeNode(g: WfGraph, id: string): Edit {
  if (!g.nodes.some((n) => n.id === id)) return fail("الخطوة مش موجودة");
  if (g.nodes.length <= 1) return fail("لازم تضل خطوة وحدة على الأقل");
  const ins = g.edges.filter((e) => e.to === id);
  const outs = g.edges.filter((e) => e.from === id);
  let edges = g.edges.filter((e) => e.from !== id && e.to !== id);
  // «in a straight line» means nothing else leaves the step before it or enters the step after it: a branch that is cut is just cut
  const straight = ins.length === 1 && outs.length === 1 && g.edges.filter((e) => e.from === ins[0]!.from).length === 1 && g.edges.filter((e) => e.to === outs[0]!.to).length === 1;
  if (straight && ins[0]!.from !== outs[0]!.to && !edges.some((e) => e.from === ins[0]!.from && e.to === outs[0]!.to)) {
    edges = [...edges, { from: ins[0]!.from, to: outs[0]!.to, ...(ins[0]!.label ? { label: ins[0]!.label } : {}) }];
  }
  return done({ nodes: g.nodes.filter((n) => n.id !== id), edges });
}

/** A copy of a node next to it, not joined to anything (the person decides where it goes). */
export function duplicateNode(g: WfGraph, id: string): Edit {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return fail("الخطوة مش موجودة");
  if (g.nodes.length >= MAX_NODES) return fail(`حد أقصى ${MAX_NODES} خطوة بالورك فلو الواحد`);
  const copyId = nextId(g, id);
  const copy: WfNode = { ...n, id: copyId, label: `${n.label} (نسخة)`.slice(0, 120), ...(hasPlace(n) ? { x: snap(n.x! + NODE_W / 2 + GRID), y: snap(n.y! + NODE_H / 2 + GRID) } : {}) };
  return done({ ...g, nodes: [...g.nodes, copy] }, copyId);
}

/** Edits a node's fields. The merged node must still be a valid one — the first problem is said in words. */
export function setNode(g: WfGraph, id: string, patch: Partial<WfNode>): Edit {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return fail("الخطوة مش موجودة");
  const merged = { ...n, ...patch, id };
  // an emptied optional field is a removed field
  for (const k of Object.keys(merged) as (keyof WfNode)[]) if (merged[k] === "" || merged[k] === undefined) delete merged[k];
  const ok = NodeSchema.safeParse(merged);
  if (!ok.success) return fail(ok.error.issues[0]?.message ?? "الخطوة مش صحيحة");
  return done({ ...g, nodes: g.nodes.map((x) => (x.id === id ? ok.data : x)) });
}

export const moveNode = (g: WfGraph, id: string, x: number, y: number): WfGraph => ({ ...g, nodes: g.nodes.map((n) => (n.id === id ? { ...n, x: snap(x), y: snap(y) } : n)) });

/** Makes `from` the ONLY thing flowing into `id` (null: nothing does). For the steps list, where «بعد: …» is one choice. */
export function setPredecessor(g: WfGraph, id: string, from: string | null): Edit {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) return fail("الخطوة مش موجودة");
  const rest: WfGraph = { ...g, edges: g.edges.filter((e) => e.to !== id) };
  if (from === null) return done(rest);
  return connect(rest, from, id);
}

// ───────────────────────────── the steps list ─────────────────────────────

/** A straight line of steps: one start, each step flows into at most one and out of at most one, no labelled lines. */
export function isChain(g: WfGraph): boolean {
  if (g.edges.some((e) => e.label)) return false;
  const ins = into(g);
  const outs = outOf(g);
  if (g.nodes.some((n) => (ins.get(n.id)?.length ?? 0) > 1 || (outs.get(n.id)?.length ?? 0) > 1)) return false;
  const starts = g.nodes.filter((n) => (ins.get(n.id)?.length ?? 0) === 0);
  return starts.length === 1 && g.edges.length === g.nodes.length - 1;
}

/** Moves a step up or down a straight line (the lines are rebuilt in the new order). Only a chain can be reordered this way. */
export function moveInChain(g: WfGraph, id: string, dir: -1 | 1): Edit {
  if (!isChain(g)) return fail("الترتيب بالأسهم بس للخطوات اللي ورا بعض — عدّل التوصيل من اللوحة");
  const order = stepOrder(g).map((n) => n.id);
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return fail("ما بتتحرك أكتر");
  [order[i], order[j]] = [order[j]!, order[i]!];
  if (g.nodes.find((n) => n.id === order[0])?.type !== "trigger" && g.nodes.some((n) => n.type === "trigger")) return fail("البداية لازم تضل أول وحدة");
  return done({ ...g, edges: order.slice(1).map((to, k) => ({ from: order[k]!, to })) });
}

// ───────────────────────────── versions ─────────────────────────────

export interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: string[];
  movedNodes: number;
  addedEdges: number;
  removedEdges: number;
}

const FIELDS = (n: WfNode) => JSON.stringify({ ...n, x: undefined, y: undefined });

export function graphDiff(a: WfGraph, b: WfGraph): GraphDiff {
  const am = new Map(a.nodes.map((n) => [n.id, n]));
  const bm = new Map(b.nodes.map((n) => [n.id, n]));
  const key = (e: WfEdge) => `${e.from}>${e.to}>${e.label ?? ""}`;
  const ae = new Set(a.edges.map(key));
  const be = new Set(b.edges.map(key));
  const both = b.nodes.filter((n) => am.has(n.id));
  return {
    addedNodes: b.nodes.filter((n) => !am.has(n.id)).map((n) => n.id),
    removedNodes: a.nodes.filter((n) => !bm.has(n.id)).map((n) => n.id),
    changedNodes: both.filter((n) => FIELDS(n) !== FIELDS(am.get(n.id)!)).map((n) => n.id),
    movedNodes: both.filter((n) => n.x !== am.get(n.id)!.x || n.y !== am.get(n.id)!.y).length,
    addedEdges: [...be].filter((k) => !ae.has(k)).length,
    removedEdges: [...ae].filter((k) => !be.has(k)).length,
  };
}

/** «+2 خطوة · −1 خطوة · 3 تعديل · +1 وصلة · 4 تحريك» — what a version changed, in a line. */
export function diffText(d: GraphDiff): string {
  const parts = [
    d.addedNodes.length ? `+${d.addedNodes.length} خطوة` : "",
    d.removedNodes.length ? `−${d.removedNodes.length} خطوة` : "",
    d.changedNodes.length ? `${d.changedNodes.length} تعديل` : "",
    d.addedEdges ? `+${d.addedEdges} وصلة` : "",
    d.removedEdges ? `−${d.removedEdges} وصلة` : "",
    d.movedNodes ? `${d.movedNodes} تحريك` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "بلا تغيير";
}

export const isChanged = (d: GraphDiff): boolean => diffText(d) !== "بلا تغيير";

// ───────────────────────────── checking before a save ─────────────────────────────

export interface GraphIssue {
  level: "error" | "warn";
  text: string;
  node?: string;
}

/** What is wrong, or odd, before a graph is saved. Errors stop the save; warnings are said and the save goes on. */
export function checkGraph(g: WfGraph): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const parsed = GraphSchema.safeParse(g);
  if (!parsed.success) for (const i of parsed.error.issues.slice(0, 3)) issues.push({ level: "error", text: i.message });
  const ins = into(g);
  const outs = outOf(g);
  if (!g.nodes.some((n) => n.type === "trigger")) issues.push({ level: "warn", text: "ما في بداية — مين بيبلّش الشغل؟" });
  for (const n of g.nodes) {
    const joined = (ins.get(n.id)?.length ?? 0) + (outs.get(n.id)?.length ?? 0) > 0;
    if (!joined && g.nodes.length > 1) issues.push({ level: "warn", text: `«${n.label}» مش موصولة بشي`, node: n.id });
    if (n.type === "condition" && (outs.get(n.id)?.length ?? 0) < 2) issues.push({ level: "warn", text: `الشرط «${n.label}» لازم يتفرّع لمسارين`, node: n.id });
    if (n.type === "approval" && n.permission !== "red" && n.permission !== "black") issues.push({ level: "warn", text: `بوّابة الموافقة «${n.label}» لازم تكون حمرا`, node: n.id });
    if (n.permission === "black" && !n.disabled) issues.push({ level: "warn", text: `«${n.label}» أسود (ممنوع على الوكلاء) — الأحسن تعطّلها`, node: n.id });
  }
  return issues;
}

// ───────────────────────────── new workflows ─────────────────────────────

export interface WorkflowTemplate {
  id: string;
  name: string;
  about: string;
  graph: WfGraph;
}

const mk = (nodes: WfNode[]): WfGraph => ({ nodes, edges: nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id })) });
const trig = (label: string): WfNode => ({ id: "start", type: "trigger", label, executor: "system", permission: "green" });
const stp = (id: string, label: string, executor: Executor = "claude_mcp", extra: Partial<WfNode> = {}): WfNode => ({ id, type: "step", label, executor, ...(executor.startsWith("claude") ? { dataSource: "mcp" as const } : {}), permission: "green", ...extra });

/** Starting points for a new workflow («من قالب»). Each is a valid graph; none carries an amount of money. */
export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { id: "blank", name: "فاضي", about: "بداية وخطوة، وإنت بتكمّل", graph: mk([trig("يدوي"), stp("step1", "خطوة جديدة")]) },
  { id: "daily", name: "فحص يومي", about: "بداية بوقت، قراءة، مقارنة، وتبليغ", graph: mk([trig("كل يوم بوقت (حدّده بالإعدادات)"), stp("read", "قراءة الأرقام"), stp("check", "مقارنتها بالقواعد"), { id: "notify", type: "notify", label: "تبليغ المالك", executor: "claude_mcp", permission: "green" }]) },
  {
    id: "approval",
    name: "بموافقتك",
    about: "تحضير، بوّابة موافقة المالك، وبعدها التنفيذ",
    graph: mk([trig("يدوي أو بحدث"), stp("prepare", "تحضير الاقتراح"), { id: "gate", type: "approval", label: "موافقة المالك", executor: "claude_mcp", permission: "red", destination: "الميديا باير ← المهام ← بانتظار موافقتك" }, stp("apply", "التنفيذ بعد الموافقة", "claude_mcp", { permission: "yellow" }), { id: "notify", type: "notify", label: "تبليغ النتيجة", executor: "claude_mcp", permission: "green" }]),
  },
  { id: "person", name: "لشخص أو وكيل", about: "طلب لميوز أو هيرمز أو شخص، وانتظار «خلص»", graph: mk([trig("يدوي"), stp("task", "طلب للمنفّذ", "hermes"), { id: "wait", type: "wait", label: "انتظار «خلص»", executor: "system", permission: "green" }, { id: "notify", type: "notify", label: "تبليغ المالك", executor: "claude_mcp", permission: "green" }]) },
];

export const templateOf = (id: string): WorkflowTemplate | undefined => WORKFLOW_TEMPLATES.find((t) => t.id === id);
export const isExecutor = (v: string): v is Executor => (EXECUTORS as readonly string[]).includes(v);

// ───────────────────────────── undo and redo ─────────────────────────────

export interface History {
  graph: WfGraph;
  past: WfGraph[];
  future: WfGraph[];
}

const HISTORY_LIMIT = 50;
export const startHistory = (graph: WfGraph): History => ({ graph, past: [], future: [] });

/** The drawing becomes `graph`, and the one before it can be come back to. The same drawing again is no step. */
export const pushHistory = (h: History, graph: WfGraph): History => (graph === h.graph ? h : { graph, past: [...h.past, h.graph].slice(-HISTORY_LIMIT), future: [] });

/** A drag in progress: the drawing moves but no step is made until the drag ends (then `commitHistory` with where it began). */
export const replaceGraph = (h: History, graph: WfGraph): History => ({ ...h, graph });

/** The drawing is `graph` now, and `base` (where a drag began) is the step to come back to. */
export const commitHistory = (h: History, base: WfGraph, graph: WfGraph): History => (graph === base ? { ...h, graph } : { graph, past: [...h.past, base].slice(-HISTORY_LIMIT), future: [] });

export const undoHistory = (h: History): History => (h.past.length ? { graph: h.past[h.past.length - 1]!, past: h.past.slice(0, -1), future: [h.graph, ...h.future] } : h);
export const redoHistory = (h: History): History => (h.future.length ? { graph: h.future[0]!, past: [...h.past, h.graph], future: h.future.slice(1) } : h);
