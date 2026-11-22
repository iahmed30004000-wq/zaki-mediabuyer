"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, Film, History as HistoryIcon, ListOrdered, Network, Plus, Radio, Redo2, RotateCcw, Save, Settings, Trash2, Undo2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { GraphSchema, type Executor, type NodeStates, type NodeType, type Permission, type WfGraph, type WfNode } from "@/core/workflow";
import {
  GRID,
  NODE_W,
  addAfter,
  addNode,
  autoLayout,
  boundsOf,
  checkGraph,
  commitHistory,
  connect,
  diffText,
  disconnect,
  duplicateNode,
  ensureLayout,
  fitView,
  graphDiff,
  insertOnEdge,
  isChanged,
  moveInChain,
  moveNode,
  pushHistory,
  redoHistory,
  removeNode,
  replaceGraph,
  setNode,
  startHistory,
  undoHistory,
  type Edit,
  type History,
  type View,
} from "@/core/workflow-edit";
import { cn } from "@/lib/utils";
import type { RunView, WorkflowCard } from "@/server/workflows";
import { ExecutorBadge, PermBadge } from "../badges";
import { Canvas, type Selection } from "./canvas";
import { NodeForm } from "./node-form";
import { NodePicker } from "./node-picker";
import { ReplayBar } from "./replay-bar";
import { SettingsSheet, type Meta } from "./settings-sheet";
import { StepsView } from "./steps-view";
import { VersionsSheet } from "./versions-sheet";
import { safeFetch } from "@/lib/call";

type Picker = { mode: "add" } | { mode: "edge"; edge: { from: string; to: string } } | { mode: "drop"; from: string; at: { x: number; y: number } } | { mode: "after"; id: string };

const ICON_BTN = "inline-flex size-10 items-center justify-center rounded-lg border border-border bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40";

/** A selected line: its name (نعم / لا for a condition) and its removal. */
function EdgeBar({ graph, edge, canEdit, onLabel, onRemove }: { graph: WfGraph; edge: { from: string; to: string }; canEdit: boolean; onLabel: (t: string) => void; onRemove: () => void }) {
  const cur = graph.edges.find((e) => e.from === edge.from && e.to === edge.to);
  const name = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const [text, setText] = useState(cur?.label ?? "");
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 p-2 text-sm" role="group" aria-label="الوصلة المحدّدة">
      <span className="min-w-0 truncate text-fg">
        وصلة: {name(edge.from)} ← {name(edge.to)}
      </span>
      {canEdit ? (
        <>
          <input value={text} dir="auto" placeholder="سمّيها (نعم / لا…)" onChange={(e) => setText(e.target.value)} onBlur={() => text !== (cur?.label ?? "") && onLabel(text)} className="min-h-10 max-md:min-h-[44px] w-40 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg" aria-label="اسم الوصلة" />
          <Button size="sm" variant="ghost" className="ms-auto min-h-10 max-md:min-h-[44px] text-danger hover:text-danger" onClick={onRemove}>
            <Trash2 className="size-4" /> احذفها
          </Button>
        </>
      ) : null}
    </div>
  );
}

/**
 * The drawing board of one workflow (v3 · F): the steps as cards you drag and join, or as a list on a phone; a card for each
 * step; every change one step of undo; one save = one new version, with its note. The run that is going shows on it, live.
 * Nothing is saved until the owner says so, and nothing is ever deleted — a removed step lives on in the version before.
 */
export function WorkflowEditor({ card, canEdit, demo }: { card: WorkflowCard; canEdit: boolean; demo: boolean }) {
  const { toast } = useToast();
  const initial = useMemo(() => ensureLayout(card.graph), [card.graph]);
  const [hist, setHist] = useState<History>(() => startHistory(initial));
  const histRef = useRef(hist);
  histRef.current = hist;
  const graph = hist.graph;
  const [baseline, setBaseline] = useState<WfGraph>(initial);
  const [version, setVersion] = useState(card.version);
  const [meta, setMeta] = useState<Meta>({ name: card.name, description: card.description ?? "", schedule: card.schedule ?? "", executor: card.executor as Executor, permission: card.permission as Permission, enabled: card.enabled });
  const [sel, setSel] = useState<Selection>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [mode, setMode] = useState<"canvas" | "steps">("canvas");
  const [wide, setWide] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [born, setBorn] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [run, setRun] = useState<RunView | null>(card.live ?? card.lastRun);
  const [showRun, setShowRun] = useState(!!card.live);
  const [replayOn, setReplayOn] = useState(false);
  const [replayStates, setReplayStates] = useState<NodeStates | null>(null);
  const dragBase = useRef<WfGraph | null>(null);
  const box = useRef({ w: 800, h: 520 });
  const g = () => histRef.current.graph;

  const diff = useMemo(() => graphDiff(baseline, graph), [baseline, graph]);
  const dirty = isChanged(diff);
  const issues = useMemo(() => checkGraph(graph), [graph]);
  const node = sel?.kind === "node" ? graph.nodes.find((n) => n.id === sel.id) ?? null : null;
  const states: NodeStates = replayStates ?? (showRun && run ? run.nodeStates : {});
  const liveNow = run?.status === "running" || run?.status === "waiting";

  // how wide the screen is: a side panel for a step's card from lg, a bottom sheet below; a phone opens in the list
  useEffect(() => {
    const m = window.matchMedia("(min-width: 1024px)");
    const f = () => setWide(m.matches);
    f();
    m.addEventListener("change", f);
    if (window.innerWidth < 768) setMode("steps");
    return () => m.removeEventListener("change", f);
  }, []);

  // the run that is going, moving on the drawing (every 5 s while it moves, every 30 s otherwise, never in the background)
  useEffect(() => {
    if (demo) return;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (document.visibilityState === "visible") {
        try {
          const r = await safeFetch("/api/workflow/live", { cache: "no-store" });
          if (r.ok) {
            const d = (await r.json()) as { workflows: WorkflowCard[] };
            const c = d.workflows.find((w) => w.key === card.key);
            if (c) setRun(c.live ?? c.lastRun);
          }
        } catch {
          // offline: the board keeps what it has
        }
      }
      timer = setTimeout(loop, 5_000);
    };
    timer = setTimeout(loop, 5_000);
    return () => clearTimeout(timer);
  }, [demo, card.key]);
  useEffect(() => {
    if (liveNow) setShowRun(true);
  }, [liveNow]);

  // leaving with unsaved changes asks first
  useEffect(() => {
    if (!dirty) return;
    const ask = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [dirty]);

  const flash = useCallback((id?: string) => {
    setAnimate(true);
    if (id) setBorn(id);
    window.setTimeout(() => {
      setAnimate(false);
      setBorn(null);
    }, 480);
  }, []);

  const doFit = useCallback(() => setView(fitView(boundsOf(histRef.current.graph), box.current)), []);
  const onSize = useCallback((b: { w: number; h: number }) => {
    box.current = b;
  }, []);
  const onFit = useCallback(
    (b: { w: number; h: number }) => {
      box.current = b;
      doFit();
    },
    [doFit],
  );

  // a draft the assistant handed over (a step it proposes): it opens as unsaved changes — the owner reviews it and saves, or undoes it
  useEffect(() => {
    if (!canEdit) return;
    const key = `mb:wf-draft:${card.key}`;
    let raw: string | null = null;
    try {
      raw = sessionStorage.getItem(key);
      sessionStorage.removeItem(key);
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as { graph?: unknown; note?: unknown };
      const parsed = GraphSchema.safeParse(d.graph);
      if (!parsed.success) return;
      setHist((h) => pushHistory(h, ensureLayout(parsed.data)));
      setNote(typeof d.note === "string" ? d.note.slice(0, 200) : "مسودة المساعد");
      flash();
      window.setTimeout(doFit, 120);
      toast("فتحت مسودة المساعد — راجعها واحفظ، أو ارجع بـ «تراجع»", "info");
    } catch {
      // a draft that does not read is ignored: the board stays as it was
    }
    // once, when the board opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** One change, one undo step. A refusal is said in words and nothing changes. */
  const commit = useCallback(
    (r: Edit): boolean => {
      if (!r.ok) {
        toast(r.error, "error");
        return false;
      }
      setHist((h) => pushHistory(h, r.graph));
      if (r.id) flash(r.id);
      return true;
    },
    [toast, flash],
  );

  // ── the board ──
  const onMoveStart = () => {
    dragBase.current = g();
  };
  const onMove = (id: string, x: number, y: number) => setHist((h) => replaceGraph(h, { ...h.graph, nodes: h.graph.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
  const onMoveEnd = (id: string) => {
    const base = dragBase.current;
    dragBase.current = null;
    const cur = g();
    const n = cur.nodes.find((x) => x.id === id);
    if (!n || !base || n.x === undefined || n.y === undefined) return;
    const snapped = moveNode(cur, id, n.x, n.y);
    setAnimate(true);
    window.setTimeout(() => setAnimate(false), 360);
    setHist((h) => (isChanged(graphDiff(base, snapped)) ? commitHistory(h, base, snapped) : { ...h, graph: base }));
  };
  const onOpen = (id: string) => {
    setSel({ kind: "node", id });
    setCardOpen(true);
  };
  const onConnect = (from: string, to: string) => {
    commit(connect(g(), from, to));
  };
  const onRemoveEdge = (e: { from: string; to: string }) => {
    commit({ ok: true, graph: disconnect(g(), e.from, e.to) });
    setSel(null);
  };
  const onLabelEdge = (e: { from: string; to: string }, text: string) =>
    commit({ ok: true, graph: { ...g(), edges: g().edges.map((x) => (x.from === e.from && x.to === e.to ? (text.trim() ? { ...x, label: text.trim().slice(0, 60) } : { from: x.from, to: x.to }) : x)) } });

  const pick = (t: NodeType) => {
    const p = picker;
    setPicker(null);
    if (!p) return;
    let r: Edit;
    if (p.mode === "edge") r = insertOnEdge(g(), p.edge, t);
    else if (p.mode === "after") r = addAfter(g(), p.id, t);
    else if (p.mode === "drop") {
      const a = addNode(g(), t, { x: p.at.x - NODE_W / 2, y: p.at.y });
      if (a.ok && t !== "trigger") {
        const c = connect(a.graph, p.from, a.id!);
        r = c.ok ? { ok: true, graph: c.graph, id: a.id } : c;
      } else r = a;
    } else r = sel?.kind === "node" ? addAfter(g(), sel.id, t) : addNode(g(), t);
    if (commit(r) && r.ok && r.id) onOpen(r.id);
  };

  const patchNode = (patch: Partial<WfNode>): string | null => {
    if (!node) return null;
    const r = setNode(g(), node.id, patch);
    if (!r.ok) return r.error;
    setHist((h) => pushHistory(h, r.graph));
    return null;
  };
  const dup = () => {
    if (!node) return;
    const r = duplicateNode(g(), node.id);
    if (commit(r) && r.ok && r.id) onOpen(r.id);
  };
  const del = () => {
    if (!node) return;
    if (commit(removeNode(g(), node.id))) {
      setSel(null);
      setCardOpen(false);
      toast("انحذفت — زر ↶ بيرجّعها", "info");
    }
  };

  const undo = () => {
    setHist(undoHistory);
    flash();
  };
  const redo = () => {
    setHist(redoHistory);
    flash();
  };
  const tidy = () => {
    setHist((h) => pushHistory(h, autoLayout(h.graph)));
    flash();
    window.setTimeout(doFit, 60);
  };
  const discard = () => {
    setHist(startHistory(baseline));
    setSel(null);
    setNote("");
    flash();
  };

  const save = async () => {
    const errors = checkGraph(g()).filter((i) => i.level === "error");
    if (errors.length) return toast(errors[0]!.text, "error");
    if (demo) return toast("بالوضع التجريبي ما انحفظ شي", "info");
    const saving_ = g();
    setSaving(true);
    const r = await safeFetch(`/api/workflow/${card.key}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph: saving_, baseVersion: version, ...(note.trim() ? { note: note.trim() } : {}) }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; workflow?: WorkflowCard };
    setSaving(false);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    if (d.demo) return toast("بالوضع التجريبي ما انحفظ شي", "info");
    setBaseline(saving_);
    const next = d.workflow?.version ?? version + 1;
    setVersion(next);
    setNote("");
    toast(`انحفظ — النسخة ${next}`, "success");
  };

  const loadDraft = (gr: WfGraph, v: number) => {
    setHist((h) => pushHistory(h, ensureLayout(gr)));
    setNote(`رجوع لنسخة ${v}`);
    setVersionsOpen(false);
    setSel(null);
    flash();
    window.setTimeout(doFit, 60);
    toast(`فتحت النسخة ${v} كمسودة — احفظ إذا بدك ترجع لها`, "info");
  };

  const removeSelection = () => {
    if (sel?.kind === "node") {
      if (commit(removeNode(g(), sel.id))) {
        setSel(null);
        setCardOpen(false);
      }
    } else if (sel?.kind === "edge") onRemoveEdge(sel);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (canEdit && sel && (e.key === "Delete" || e.key === "Backspace")) {
      e.preventDefault();
      removeSelection();
    } else if (canEdit && sel?.kind === "node" && e.key.startsWith("Arrow")) {
      const n = g().nodes.find((x) => x.id === sel.id);
      if (!n || n.x === undefined || n.y === undefined) return;
      e.preventDefault();
      const step = e.shiftKey ? GRID * 4 : GRID;
      const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
      const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
      setHist((h) => pushHistory(h, moveNode(h.graph, sel.id, n.x! + dx, n.y! + dy)));
    } else if (e.key === "Escape") {
      setSel(null);
      setCardOpen(false);
    }
  };

  const form = node ? <NodeForm key={node.id} node={node} graph={graph} readOnly={!canEdit} onChange={patchNode} onDuplicate={dup} onRemove={del} onAddAfter={() => setPicker({ mode: "after", id: node.id })} onGraph={(ng) => setHist((h) => pushHistory(h, ng))} /> : null;
  const hasRun = !!run && Object.keys(run.nodeStates).length > 0;

  return (
    <div className="space-y-3" onKeyDown={onKey}>
      <header className="flex flex-wrap items-center gap-2">
        <Link href="/work" className="inline-flex min-h-10 max-md:min-h-[44px] items-center gap-1 rounded-lg border border-border px-3 text-sm text-fg-muted hover:bg-surface-2 hover:text-fg">
          <ArrowRight className="size-4" /> الورك فلو
        </Link>
        <h2 className="flex min-w-[9rem] flex-1 items-center gap-2 text-base font-bold text-fg">
          {liveNow ? <Radio className="size-4 shrink-0 animate-pulse text-accent motion-reduce:animate-none" aria-label="شغّال هلأ" /> : null}
          <span className="truncate">{meta.name}</span>
          <span dir="ltr" className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-xs font-medium text-fg-muted">v{version}</span>
        </h2>
        <span className="flex shrink-0 items-center gap-1.5">
          <PermBadge permission={meta.permission} />
          <ExecutorBadge executor={meta.executor} />
        </span>
        <Button variant="secondary" size="sm" className="min-h-10 max-md:min-h-[44px]" onClick={() => setSettingsOpen(true)}>
          <Settings className="size-4" /> الإعدادات
        </Button>
        <Button variant="secondary" size="sm" className="min-h-10 max-md:min-h-[44px]" onClick={() => setVersionsOpen(true)} data-tour="versions">
          <HistoryIcon className="size-4" /> النسخ
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2" data-tour="toolbar">
        <div role="group" aria-label="طريقة العرض" className="inline-flex rounded-lg border border-border bg-surface-1 p-1">
          {([["canvas", "اللوحة", Network], ["steps", "الخطوات", ListOrdered]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={cn("inline-flex min-h-10 max-md:min-h-[44px] items-center gap-1.5 rounded-md px-3 text-sm font-medium", mode === k ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}>
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        {canEdit ? (
          <>
            <Button size="sm" className="min-h-10 max-md:min-h-[44px]" onClick={() => setPicker({ mode: "add" })} data-tour="add">
              <Plus className="size-4" /> خطوة
            </Button>
            <span className="inline-flex gap-1.5">
              <button type="button" aria-label="تراجع" title="تراجع (Ctrl+Z)" className={ICON_BTN} disabled={!hist.past.length} onClick={undo}>
                <Undo2 className="size-4" />
              </button>
              <button type="button" aria-label="إعادة" title="إعادة (Ctrl+Shift+Z)" className={ICON_BTN} disabled={!hist.future.length} onClick={redo}>
                <Redo2 className="size-4" />
              </button>
            </span>
            {mode === "canvas" ? (
              <Button size="sm" variant="secondary" className="min-h-10 max-md:min-h-[44px]" onClick={tidy} title="رتّب الخطوات لحالها">
                <Wand2 className="size-4" /> ترتيب تلقائي
              </Button>
            ) : null}
          </>
        ) : (
          <span className="rounded-lg bg-surface-2 px-3 py-1.5 text-xs text-fg-muted">للمشاهدة بس — التعديل للمالك</span>
        )}
        <button type="button" aria-pressed={replayOn} onClick={() => setReplayOn((v) => !v)} className={cn("ms-auto inline-flex min-h-10 max-md:min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs", replayOn ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>
          <Film className="size-3.5" /> إعادة عرض
        </button>
        {hasRun ? (
          <button type="button" aria-pressed={showRun} onClick={() => setShowRun((v) => !v)} className={cn("inline-flex min-h-10 max-md:min-h-[44px] items-center gap-1.5 rounded-lg border px-3 text-xs", showRun ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>
            <Radio className="size-3.5" /> {liveNow ? "التشغيل الحالي" : "آخر تشغيل"}
          </button>
        ) : null}
      </div>

      {replayOn ? <ReplayBar workflowKey={card.key} graph={graph} startRef={run?.id} onStates={setReplayStates} onClose={() => setReplayOn(false)} /> : null}

      {canEdit && dirty ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-warn/40 bg-warn/5 p-2" role="status" data-tour="save">
          <span className="text-sm font-medium text-fg">تغييرات ما انحفظت</span>
          <span className="text-xs text-fg-muted">{diffText(diff)}</span>
          <input value={note} dir="auto" onChange={(e) => setNote(e.target.value)} placeholder="ملاحظة للنسخة (اختياري)" aria-label="ملاحظة للنسخة" className="min-h-10 max-md:min-h-[44px] min-w-0 flex-1 basis-40 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg" />
          <Button size="sm" variant="ghost" className="min-h-10 max-md:min-h-[44px]" onClick={discard}>
            <RotateCcw className="size-4" /> ارجع للمحفوظ
          </Button>
          <Button size="sm" className="min-h-10 max-md:min-h-[44px]" onClick={save} disabled={saving}>
            <Save className="size-4" /> {saving ? "لحظة…" : `احفظ نسخة ${version + 1}`}
          </Button>
        </div>
      ) : null}

      {sel?.kind === "edge" ? <EdgeBar key={`${sel.from}>${sel.to}`} graph={graph} edge={sel} canEdit={canEdit} onLabel={(t) => onLabelEdge(sel, t)} onRemove={() => onRemoveEdge(sel)} /> : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="relative h-[calc(100dvh-17rem)] min-h-[26rem] overflow-hidden rounded-card border border-border bg-surface-1">
          {mode === "canvas" ? (
            <Canvas
              graph={graph}
              states={states}
              selection={sel}
              view={view}
              onView={setView}
              onFit={onFit}
              onSize={onSize}
              readOnly={!canEdit}
              animate={animate}
              born={born}
              onSelect={(s) => {
                setSel(s);
                if (!s) setCardOpen(false);
              }}
              onOpen={onOpen}
              onMoveStart={onMoveStart}
              onMove={onMove}
              onMoveEnd={onMoveEnd}
              onConnect={onConnect}
              onDropOnEmpty={(from, at) => setPicker({ mode: "drop", from, at })}
              onInsert={(edge) => setPicker({ mode: "edge", edge })}
              onRemoveEdge={onRemoveEdge}
            />
          ) : (
            <StepsView
              graph={graph}
              states={states}
              readOnly={!canEdit}
              selected={node?.id ?? null}
              onOpen={onOpen}
              onMove={(id, dir) => commit(moveInChain(g(), id, dir))}
            />
          )}
        </div>

        {wide ? (
          <aside className="max-h-[calc(100dvh-17rem)] min-h-[12rem] overflow-y-auto rounded-card border border-border bg-surface-1 p-3" aria-label="بطاقة الفرع">
            {form ? (
              <>
                <h3 className="mb-3 text-sm font-bold text-fg">{node?.label}</h3>
                {form}
              </>
            ) : (
              <div className="space-y-2 text-sm leading-6 text-fg-muted">
                <h3 className="text-sm font-bold text-fg">كيف بتشتغل اللوحة</h3>
                <ul className="list-disc space-y-1 ps-5">
                  <li>اضغط على فرع: بتنفتح بطاقتها وبتعدّلها.</li>
                  <li>اسحب الفرع لمكانها.</li>
                  <li>للتوصيل: اسحب من النقطة تحت الفرع لفرع تانية. إذا فلتّها بمكان فاضي بتعمل فرع جديدة هناك.</li>
                  <li>«+» على الخط بيحط فرع عليه. اضغط على الخط لتسمّيه أو تحذفه.</li>
                  <li>Ctrl + عجلة الماوس أو قرصة بإصبعين للتكبير.</li>
                  <li>ما بينحفظ شي لحد ما تضغط «احفظ» — وكل حفظ نسخة تقدر ترجع لها.</li>
                </ul>
              </div>
            )}
          </aside>
        ) : null}
      </div>

      {issues.length ? (
        <ul className="space-y-1 rounded-xl border border-dashed border-border p-2.5 text-xs leading-5 text-fg-muted" aria-label="ملاحظات على الرسم">
          {issues.slice(0, 4).map((i, n) => (
            <li key={n} className={cn(i.level === "error" && "text-danger")}>
              {i.level === "error" ? "✕" : "•"} {i.text}
            </li>
          ))}
        </ul>
      ) : null}

      <Sheet open={!wide && cardOpen && !!node} onOpenChange={(o) => !o && setCardOpen(false)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{node?.label ?? ""}</SheetTitle>
            <SheetDescription>بطاقة الفرع — كل تعديل بينحسب لما تطلع من الخانة</SheetDescription>
          </SheetHeader>
          <SheetBody>{form}</SheetBody>
        </SheetContent>
      </Sheet>

      <NodePicker
        open={!!picker}
        title={picker?.mode === "edge" ? "ضيف فرع على الخط" : picker?.mode === "drop" ? "فرع جديدة هون" : picker?.mode === "after" ? "ضيف فرع بعدها" : sel?.kind === "node" ? "ضيف فرع بعد المحدّدة" : "ضيف فرع"}
        onPick={pick}
        onClose={() => setPicker(null)}
      />
      <SettingsSheet key={`s-${settingsOpen}`} open={settingsOpen} onClose={() => setSettingsOpen(false)} workflowKey={card.key} meta={meta} canEdit={canEdit} demo={demo} onSaved={setMeta} />
      <VersionsSheet open={versionsOpen} onClose={() => setVersionsOpen(false)} workflowKey={card.key} canEdit={canEdit} demo={demo} onLoad={loadDraft} />
    </div>
  );
}
