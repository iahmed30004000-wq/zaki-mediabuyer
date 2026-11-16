"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Bell, Clock, GitBranch, Hourglass, Minus, Play, Plus, Scan, UserCheck, X } from "lucide-react";
import type { NodeStates, NodeType, WfGraph } from "@/core/workflow";
import { NODE_H, NODE_W, TYPE_AR, connect, edgeGeometry, toWorld, zoomAt, type View } from "@/core/workflow-edit";
import { miniMap, viewAtMapPoint } from "@/core/workflow-replay";
import { cn } from "@/lib/utils";
import type { Executor } from "@/core/workflow";
import { EXECUTOR_AR } from "@/core/workflow";
import { PermBadge, StateIcon } from "../badges";
import "../workflow.css";
import "./editor.css";

/** One short word for who does a step: «Claude» for every kind of Claude, else its Arabic name. */
export const executorShort = (x: Executor | undefined): string => (!x ? "" : x.startsWith("claude") ? "Claude" : EXECUTOR_AR[x]);

export const TYPE_ICON: Record<NodeType, typeof Play> = { trigger: Clock, step: Play, condition: GitBranch, approval: UserCheck, wait: Hourglass, notify: Bell };

export type Selection = { kind: "node"; id: string } | { kind: "edge"; from: string; to: string } | null;

type Gesture =
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number; moved: boolean; edge?: { from: string; to: string } }
  | { kind: "node"; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: "connect"; from: string }
  | { kind: "pinch"; d0: number; v0: View; cx0: number; cy0: number }
  | null;

const TAP = 5;
const isMoving = (s: NodeStates, id: string) => ["running", "handoff", "approval"].includes(s[id]?.status ?? "");

export interface CanvasProps {
  graph: WfGraph;
  states: NodeStates;
  selection: Selection;
  view: View;
  onView: (v: View) => void;
  /** asks the owner of the view to fit the whole drawing into this box */
  onFit: (box: { w: number; h: number }) => void;
  /** the board's size changed (the screen turned, a panel opened) */
  onSize: (box: { w: number; h: number }) => void;
  readOnly?: boolean;
  /** the steps slide to their new places (a tidy-up, an undo, an insert) instead of jumping */
  animate?: boolean;
  /** the id of a step that was just made (it grows in) */
  born?: string | null;
  onSelect: (s: Selection) => void;
  /** a tap on a step: its card opens */
  onOpen: (id: string) => void;
  /** a drag is about to move a step (the editor keeps the drawing as it was, for undo) */
  onMoveStart: () => void;
  onMove: (id: string, x: number, y: number) => void;
  onMoveEnd: (id: string) => void;
  onConnect: (from: string, to: string) => void;
  /** a line was let go on empty floor: where a new step could go */
  onDropOnEmpty: (from: string, at: { x: number; y: number }) => void;
  onInsert: (edge: { from: string; to: string }) => void;
  onRemoveEdge: (edge: { from: string; to: string }) => void;
}

/**
 * The drawing board. Steps are cards you drag; a line is made by dragging from the dot under a card onto another card (or onto
 * empty floor, to make a new step there); a «+» on a line puts a step on it; a pinch or Ctrl + wheel zooms, the floor drags, the
 * wheel pans. Every change is a callback — this component owns only the gesture in progress.
 */
export function Canvas({ graph, states, selection, view, onView, onFit, onSize, readOnly, animate, born, onSelect, onOpen, onMoveStart, onMove, onMoveEnd, onConnect, onDropOnEmpty, onInsert, onRemoveEdge }: CanvasProps) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const live = useRef({ view, graph });
  live.current = { view, graph };
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [touch, setTouch] = useState(false);
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [box, setBox] = useState({ w: 0, h: 0 });

  const nodes = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph.nodes]);
  const map = useMemo(() => (box.w > 0 && graph.nodes.length > 1 ? miniMap(graph, view, box) : null), [graph, view, box]);
  const lines = useMemo(
    () =>
      graph.edges.flatMap((e) => {
        const a = nodes.get(e.from);
        const b = nodes.get(e.to);
        if (!a || !b || a.x === undefined || a.y === undefined || b.x === undefined || b.y === undefined) return [];
        return [{ e, ...edgeGeometry({ x: a.x, y: a.y }, { x: b.x, y: b.y }) }];
      }),
    [graph.edges, nodes],
  );

  // fit when the board gets its size, and again when it changes — until the person pans or zooms: then the view is theirs
  const touched = useRef(false);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      if (width <= 0 || height <= 0) return;
      onSize({ w: width, h: height });
      setBox({ w: width, h: height });
      if (!touched.current) onFit({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
    // the callbacks are stable; a new fit only comes from a size change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a tap or drag on the minimap puts that spot of the drawing in the middle of the board
  const go = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!map) return;
    const r = e.currentTarget.getBoundingClientRect();
    touched.current = true;
    onView(viewAtMapPoint(map, e.clientX - r.left, e.clientY - r.top, live.current.view, box));
  };

  // Ctrl (or a trackpad pinch) + wheel zooms around the cursor; the plain wheel pans. A native listener, so the page does not scroll too.
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = live.current.view;
      const r = el.getBoundingClientRect();
      touched.current = true;
      if (e.ctrlKey || e.metaKey) onView(zoomAt(v, v.k * Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top));
      else onView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, [onView]);

  const local = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function down(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
    if (e.pointerType === "touch") setTouch(true);
    const t = e.target as HTMLElement;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    root.current!.setPointerCapture(e.pointerId);

    if (pointers.current.size === 2 && (gesture.current === null || gesture.current.kind === "pan")) {
      const [a, b] = [...pointers.current.values()];
      const c = local({ clientX: (a!.x + b!.x) / 2, clientY: (a!.y + b!.y) / 2 });
      gesture.current = { kind: "pinch", d0: Math.hypot(a!.x - b!.x, a!.y - b!.y) || 1, v0: live.current.view, cx0: c.x, cy0: c.y };
      return;
    }
    if (pointers.current.size > 1) return;

    const handle = t.closest<HTMLElement>("[data-handle]");
    const nodeEl = t.closest<HTMLElement>("[data-node]");
    const edgeEl = t.closest<SVGElement>("[data-edge]");
    if (handle && !readOnly) {
      const from = handle.dataset.handle!;
      gesture.current = { kind: "connect", from };
      const p = toWorld(live.current.view, local(e).x, local(e).y);
      setLink({ from, x: p.x, y: p.y });
      setTargets(new Set(live.current.graph.nodes.filter((n) => n.id !== from && connect(live.current.graph, from, n.id).ok).map((n) => n.id)));
      return;
    }
    if (nodeEl) {
      const n = nodes.get(nodeEl.dataset.node!);
      if (n && n.x !== undefined && n.y !== undefined) gesture.current = { kind: "node", id: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, moved: false };
      return;
    }
    const v = live.current.view;
    const [from, to] = edgeEl?.dataset.edge?.split(">") ?? [];
    gesture.current = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, moved: false, ...(from && to ? { edge: { from, to } } : {}) };
  }

  function move(e: React.PointerEvent) {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    const v = live.current.view;
    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const c = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      const w0 = toWorld(g.v0, g.cx0, g.cy0);
      touched.current = true;
      const z = zoomAt(g.v0, g.v0.k * (d / g.d0), g.cx0, g.cy0).k;
      onView({ k: z, x: c.x - w0.x * z, y: c.y - w0.y * z });
      return;
    }
    if (g.kind === "pan") {
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < TAP) return;
      if (!g.moved) {
        g.moved = true;
        touched.current = true;
        setPanning(true);
      }
      onView({ k: v.k, x: g.ox + (e.clientX - g.sx), y: g.oy + (e.clientY - g.sy) });
      return;
    }
    if (g.kind === "node") {
      if (readOnly) return;
      if (!g.moved && Math.hypot(e.clientX - g.sx, e.clientY - g.sy) < TAP) return;
      if (!g.moved) {
        g.moved = true;
        setDragging(g.id);
        onMoveStart();
      }
      onMove(g.id, g.ox + (e.clientX - g.sx) / v.k, g.oy + (e.clientY - g.sy) / v.k);
      return;
    }
    if (g.kind === "connect") {
      const p = toWorld(v, local(e).x, local(e).y);
      setLink({ from: g.from, x: p.x, y: p.y });
    }
  }

  function up(e: React.PointerEvent) {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (root.current?.hasPointerCapture(e.pointerId)) root.current.releasePointerCapture(e.pointerId);
    if (pointers.current.size > 0) {
      // a pinch lost one finger: the other one does nothing more until it lifts
      if (g?.kind === "pinch") gesture.current = null;
      return;
    }
    gesture.current = null;
    setPanning(false);
    setDragging(null);
    setLink(null);
    setTargets(new Set());
    if (!g) return;
    if (g.kind === "node") {
      if (g.moved) onMoveEnd(g.id);
      else onOpen(g.id);
    } else if (g.kind === "pan") {
      if (!g.moved) onSelect(g.edge ? { kind: "edge", ...g.edge } : null);
    } else if (g.kind === "connect") {
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-node]");
      if (hit && hit.dataset.node !== g.from) onConnect(g.from, hit.dataset.node!);
      else if (!hit) onDropOnEmpty(g.from, toWorld(live.current.view, local(e).x, local(e).y));
    }
  }

  function cancel(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setPanning(false);
    setDragging(null);
    setLink(null);
    setTargets(new Set());
  }

  const zoom = (f: number) => {
    touched.current = true;
    const r = root.current!.getBoundingClientRect();
    onView(zoomAt(view, view.k * f, r.width / 2, r.height / 2));
  };

  const from = link ? nodes.get(link.from) : null;
  const linkPath = from && link && from.x !== undefined && from.y !== undefined ? edgeGeometry({ x: from.x, y: from.y }, { x: link.x - NODE_W / 2, y: link.y }).d : null;
  const grid = 16 * view.k;

  return (
    <div
      ref={root}
      role="application"
      aria-label="لوحة رسم المهمة: اسحب الخطوات، وصّلها من النقطة تحتها، و«+» على الخط بيضيف فرع"
      tabIndex={0}
      dir="ltr"
      data-panning={panning}
      data-linking={!!link}
      data-touch={touch}
      data-tour="canvas"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      className={cn("wfe-root h-full w-full", animate && "wfe-animate")}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${view.x}px ${view.y}px` }}
    >
      <div className="wfe-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }}>
        <svg className="wfe-edges" aria-hidden>
          <defs>
            <marker id="wfe-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          {lines.map(({ e, d }) => {
            const flowing = states[e.from]?.status === "done" && isMoving(states, e.to);
            const sel = selection?.kind === "edge" && selection.from === e.from && selection.to === e.to;
            return (
              <g key={`${e.from}>${e.to}`} className="wfe-edge-g" data-selected={sel}>
                <path d={d} className="wf-edge" data-flowing={flowing} fill="none" markerEnd="url(#wfe-arrow)" />
                <path d={d} className="wfe-hit" fill="none" data-edge={`${e.from}>${e.to}`} />
              </g>
            );
          })}
          {linkPath ? <path d={linkPath} className="wfe-link" markerEnd="url(#wfe-arrow)" /> : null}
        </svg>

        {graph.nodes.map((n) => {
          if (n.x === undefined || n.y === undefined) return null;
          const st = states[n.id];
          const Icon = TYPE_ICON[n.type];
          const sel = selection?.kind === "node" && selection.id === n.id;
          return (
            <div
              key={n.id}
              role="button"
              tabIndex={0}
              data-node={n.id}
              data-type={n.type}
              data-state={st?.status ?? "idle"}
              data-selected={sel}
              data-dragging={dragging === n.id}
              data-disabled={!!n.disabled}
              data-born={born === n.id}
              data-target={targets.has(n.id)}
              aria-label={`${n.label} — ${TYPE_AR[n.type]}${n.disabled ? " (معطّلة)" : ""}`}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onOpen(n.id);
                }
              }}
              className="wfe-node wf-node"
              style={{ transform: `translate(${n.x}px, ${n.y}px)`, width: NODE_W, height: NODE_H }}
            >
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-surface-2 text-fg-muted">
                <Icon className="size-4" />
              </span>
              <span dir="rtl" className="min-w-0 flex-1 text-start">
                <span className="block truncate text-xs font-semibold text-fg">{n.label}</span>
                <span className="mt-1 flex items-center gap-1">
                  <PermBadge permission={n.permission} />
                  <span className="min-w-0 truncate text-xs text-fg-muted">{executorShort(n.executor)}</span>
                </span>
              </span>
              <StateIcon status={st?.status} />
              <span className="wfe-handle wfe-in" aria-hidden />
              {readOnly ? null : <span className="wfe-handle wfe-out" data-handle={n.id} role="presentation" title="اسحب لفرع تانية لتوصلها" />}
            </div>
          );
        })}

        {lines.map(({ e, mid }) => {
          const sel = selection?.kind === "edge" && selection.from === e.from && selection.to === e.to;
          return (
            <div key={`m-${e.from}>${e.to}`}>
              {e.label ? (
                <span className="wfe-label" style={{ left: mid.x, top: mid.y }}>
                  {e.label}
                </span>
              ) : null}
              {readOnly ? null : (
                <span className="wfe-mid" style={{ left: mid.x, top: mid.y }}>
                  <button type="button" aria-label={`ضيف فرع بين ${nodes.get(e.from)?.label} و${nodes.get(e.to)?.label}`} title="ضيف فرع هون" onClick={() => onInsert({ from: e.from, to: e.to })}>
                    <Plus className="size-3.5" />
                  </button>
                  {sel ? (
                    <button type="button" aria-label="احذف الوصلة" title="احذف الوصلة" onClick={() => onRemoveEdge({ from: e.from, to: e.to })}>
                      <X className="size-3.5" />
                    </button>
                  ) : null}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {map ? (
        <svg
          width={map.w}
          height={map.h}
          role="img"
          aria-label="خريطة مصغّرة للرسم — اضغط عليها أو اسحب لتروح لمكان"
          data-tour="minimap"
          className="absolute bottom-3 end-3 z-10 hidden cursor-pointer touch-none rounded-lg border border-border bg-surface-1/90 shadow-card md:block"
          onPointerDown={(e) => {
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            go(e);
          }}
          onPointerMove={(e) => {
            e.stopPropagation();
            if (e.buttons === 1) go(e);
          }}
          onPointerUp={(e) => e.stopPropagation()}
        >
          {map.boxes.map((b) => {
            const st = states[b.id]?.status;
            return <rect key={b.id} x={b.x} y={b.y} width={Math.max(2, b.w)} height={Math.max(2, b.h)} rx={1.5} className={st === "failed" ? "fill-danger/70" : st === "running" || st === "handoff" || st === "approval" ? "fill-accent/80" : st === "done" ? "fill-ok/60" : "fill-fg-muted/40"} />;
          })}
          <rect x={map.viewport.x} y={map.viewport.y} width={map.viewport.w} height={map.viewport.h} fill="none" strokeWidth={1.5} className="stroke-accent" />
        </svg>
      ) : null}

      <div className="absolute bottom-3 start-3 z-10 flex flex-col gap-1.5" dir="rtl">
        {[
          { label: "قرّب", icon: Plus, run: () => zoom(1.25) },
          { label: "بعّد", icon: Minus, run: () => zoom(0.8) },
          {
            label: "ظبّط على الشاشة",
            icon: Scan,
            run: () => {
              touched.current = false;
              const r = root.current!.getBoundingClientRect();
              onFit({ w: r.width, h: r.height });
            },
          },
        ].map((b) => (
          <button key={b.label} type="button" aria-label={b.label} title={b.label} onClick={b.run} className="inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-fg-muted shadow-card hover:bg-surface-2 hover:text-fg">
            <b.icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
