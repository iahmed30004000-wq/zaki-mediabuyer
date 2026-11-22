/**
 * REPLAYING A RUN, THE MINIMAP, AND TRYING A STEP'S WORDS (v3 · F), pure — nothing here reads a database or a screen.
 *
 *   replay    a finished run keeps ONE state per step (its last one, and when it came). The replay lays those states out as a
 *             film: the steps in the order they reported (ties by the order the drawing runs), one frame each; between two frames
 *             the next step(s) whose lines are all done show as «عم يشتغل». That in-between is inferred, never recorded, and the
 *             screen says so — the frames themselves are the run's own facts.
 *   minimap   the whole drawing as small boxes with the window you are looking at, and where a tap on it should move the view.
 *   prompt    a step's instructions with their {{variables}}: which ones there are, the text with sample values put in, and what
 *             is still missing — no model is called, nothing is sent.
 */
import { refuseIfPrivate } from "./push-rows";
import { stepOrder, type NodeState, type NodeStates, type NodeStatus, type WfGraph } from "./workflow";
import { NODE_H, NODE_W, boundsOf, type Bounds, type View } from "./workflow-edit";

// ───────────────────────────── replay ─────────────────────────────

export interface ReplayEvent {
  id: string;
  label: string;
  status: NodeStatus;
  at: string;
  note?: string;
}

/** What each last state means, as a short phrase after the step's name. */
export const REPLAY_VERB_AR: Record<NodeStatus, string> = {
  waiting: "بالانتظار",
  running: "كانت عم تشتغل",
  done: "خلصت",
  failed: "فشلت",
  handoff: "وقفت وسلّمها Claude",
  approval: "وقفت عند موافقتك",
  skipped: "انتخطّت",
};

const ms = (iso: string): number => {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
};

/**
 * One event per step that reported, in the order they happened. A state whose time does not read goes last; two states at the
 * same instant (a run that only said «finished» marks every step at once) keep the order the drawing runs in. States of steps
 * that are not in this drawing (the run was of an older version) are not events — `unknown` counts them.
 */
export function replayEvents(graph: WfGraph, states: NodeStates): { events: ReplayEvent[]; unknown: number } {
  const order = new Map(stepOrder(graph).map((n, i) => [n.id, i]));
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const events: ReplayEvent[] = [];
  let unknown = 0;
  for (const [id, s] of Object.entries(states ?? {})) {
    const n = byId.get(id);
    if (!n || !s) {
      unknown += 1;
      continue;
    }
    events.push({ id, label: n.label, status: s.status, at: s.at, ...(s.note ? { note: s.note } : {}) });
  }
  events.sort((a, b) => ms(a.at) - ms(b.at) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  return { events, unknown };
}

/** The states on screen after the first `upTo` events (0 = before anything), plus «running» for the steps whose lines are all done. */
export function replayAt(graph: WfGraph, events: ReplayEvent[], upTo: number): NodeStates {
  const n = Math.max(0, Math.min(events.length, Math.floor(upTo)));
  const applied = new Map<string, ReplayEvent>(events.slice(0, n).map((e) => [e.id, e]));
  const later = new Set(events.slice(n).map((e) => e.id));
  const reported = new Set(events.map((e) => e.id));
  const out: NodeStates = {};
  for (const e of applied.values()) out[e.id] = { status: e.status, at: e.at, ...(e.note ? { note: e.note } : {}) } as NodeState;
  const last = n ? events[n - 1]!.at : (events[0]?.at ?? "");
  const preds = new Map<string, string[]>();
  for (const e of graph.edges) preds.set(e.to, [...(preds.get(e.to) ?? []), e.from]);
  for (const node of graph.nodes) {
    if (!later.has(node.id) || node.disabled) continue;
    // a line counts as done when its step finished in the film so far — or never reported at all (a caller that skipped it)
    const ready = (preds.get(node.id) ?? []).every((p) => (applied.has(p) ? ["done", "skipped"].includes(applied.get(p)!.status) : !reported.has(p)));
    if (ready) out[node.id] = { status: "running", at: last };
  }
  return out;
}

/** The caption of the frame after `upTo` events. */
export function replayCaption(events: ReplayEvent[], upTo: number): string {
  if (!events.length) return "ما في خطوات مسجّلة بهالتشغيل";
  if (upTo <= 0) return "بداية التشغيل";
  const e = events[Math.min(upTo, events.length) - 1]!;
  return `${e.label} — ${REPLAY_VERB_AR[e.status]}`;
}

// ───────────────────────────── minimap ─────────────────────────────

export interface MiniMap {
  /** the drawing's size in the map's own units */
  w: number;
  h: number;
  /** every placed step as a box */
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
  /** the part of the drawing the board shows now (it may stick out of the drawing: the map covers both) */
  viewport: { x: number; y: number; w: number; h: number };
  /** map units → world units, and where the map's origin is in the world */
  scale: number;
  origin: { x: number; y: number };
}

/** The map for a drawing, a board of `box` px showing it through `view`, drawn into at most `size` px. */
export function miniMap(graph: WfGraph, view: View, box: { w: number; h: number }, size = { w: 160, h: 110 }): MiniMap {
  const b: Bounds = boundsOf(graph);
  const win = { x: -view.x / view.k, y: -view.y / view.k, w: box.w / view.k, h: box.h / view.k };
  const x0 = Math.min(b.x, win.x);
  const y0 = Math.min(b.y, win.y);
  const x1 = Math.max(b.x + b.w, win.x + win.w);
  const y1 = Math.max(b.y + b.h, win.y + win.h);
  const ww = Math.max(1, x1 - x0);
  const hh = Math.max(1, y1 - y0);
  const scale = Math.min(size.w / ww, size.h / hh);
  const to = (x: number, y: number, w: number, h: number) => ({ x: (x - x0) * scale, y: (y - y0) * scale, w: w * scale, h: h * scale });
  return {
    w: ww * scale,
    h: hh * scale,
    boxes: graph.nodes.filter((n) => n.x !== undefined && n.y !== undefined).map((n) => ({ id: n.id, ...to(n.x!, n.y!, NODE_W, NODE_H) })),
    viewport: to(win.x, win.y, win.w, win.h),
    scale,
    origin: { x: x0, y: y0 },
  };
}

/** The view that puts the world point under a tap on the map (map units) at the middle of the board. */
export function viewAtMapPoint(map: MiniMap, mx: number, my: number, view: View, box: { w: number; h: number }): View {
  const wx = map.origin.x + mx / map.scale;
  const wy = map.origin.y + my / map.scale;
  return { k: view.k, x: box.w / 2 - wx * view.k, y: box.h / 2 - wy * view.k };
}

// ───────────────────────────── a step's words ─────────────────────────────

const VAR = /\{\{\s*([A-Za-z_؀-ۿ][\w؀-ۿ.-]{0,38})\s*\}\}/g;

/** The distinct {{variables}} of a text, in the order they first appear. */
export function promptVars(text: string): string[] {
  const seen: string[] = [];
  for (const m of text.matchAll(VAR)) if (!seen.includes(m[1]!)) seen.push(m[1]!);
  return seen;
}

export interface PromptTrial {
  /** the instructions with every given value put in; a variable with no value stays as {{name}} */
  text: string;
  vars: string[];
  /** variables that have no value (or an empty one) */
  missing: string[];
  /** values that look like a phone number, an e-mail or a key — refused: nothing like that goes into a step's words */
  refused: { name: string; why: string }[];
  /** the length the instructions will have (the model-facing limit of a step's words is 8000) */
  length: number;
}

/** Puts `values` into a step's instructions. Pure text: no model, no send. */
export function tryPrompt(prompt: string, values: Record<string, string>): PromptTrial {
  const vars = promptVars(prompt);
  const refused: PromptTrial["refused"] = [];
  const clean: Record<string, string> = {};
  for (const name of vars) {
    const v = (values[name] ?? "").trim().slice(0, 200);
    if (!v) continue;
    const why = refuseIfPrivate(v);
    if (why) refused.push({ name, why });
    else clean[name] = v;
  }
  const text = prompt.replace(VAR, (whole, name: string) => (name in clean ? clean[name]! : whole));
  return { text, vars, missing: vars.filter((v) => !(v in clean)), refused, length: text.length };
}
