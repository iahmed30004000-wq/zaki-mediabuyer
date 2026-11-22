"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, X } from "lucide-react";
import type { NodeStates, WfGraph } from "@/core/workflow";
import { replayAt, replayCaption, replayEvents } from "@/core/workflow-replay";
import { cn } from "@/lib/utils";
import type { RunView } from "@/server/workflows";

const RUN_AR: Record<string, string> = { running: "عم يشتغل", ok: "خلص", failed: "فشل", waiting: "متوقف", skipped: "تخطّى" };
const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const STEP_MS = 1100;

/**
 * Replays a past run on the drawing: pick the run, press play (or step with the arrows or the slider) and the steps take their
 * states one after the other, in the order they reported. What a step was doing between two frames is inferred (it says so);
 * the frames themselves are what the run recorded. Reports each frame's states to the board, and null when closed.
 */
export function ReplayBar({ workflowKey, graph, startRef, onStates, onClose }: { workflowKey: string; graph: WfGraph; startRef?: string; onStates: (s: NodeStates | null) => void; onClose: () => void }) {
  const [runs, setRuns] = useState<RunView[] | null>(null);
  const [pick, setPick] = useState<string>(startRef ?? "");
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`/api/workflow/${workflowKey}`)
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d: { runs: RunView[] }) => {
        if (!alive) return;
        const withStates = d.runs.filter((r) => Object.keys(r.nodeStates ?? {}).length > 0);
        setRuns(withStates);
        setPick((p) => (p && withStates.some((r) => r.id === p) ? p : (withStates[0]?.id ?? "")));
      })
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, [workflowKey]);

  const run = runs?.find((r) => r.id === pick) ?? null;
  const { events, unknown } = useMemo(() => (run ? replayEvents(graph, run.nodeStates) : { events: [], unknown: 0 }), [graph, run]);
  const last = events.length;

  // the run changed: start from the beginning
  useEffect(() => {
    setFrame(0);
    setPlaying(false);
  }, [pick]);

  // what the board shows
  useEffect(() => {
    onStates(run ? replayAt(graph, events, frame) : null);
  }, [run, graph, events, frame, onStates]);
  useEffect(() => () => onStates(null), [onStates]);

  // play: one frame at a time, stops at the end
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!playing) return;
    if (frame >= last) return setPlaying(false);
    timer.current = setTimeout(() => setFrame((f) => Math.min(last, f + 1)), STEP_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [playing, frame, last]);

  const btn = "inline-flex size-9 items-center justify-center rounded-lg border border-border bg-surface-1 text-fg-muted hover:bg-surface-2 hover:text-fg disabled:pointer-events-none disabled:opacity-40";
  return (
    <section aria-label="إعادة عرض تشغيل" className="space-y-2 rounded-xl border border-accent/40 bg-accent/5 p-2.5" data-tour="replay">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-fg">إعادة العرض</span>
        {runs === null ? (
          <span className="text-xs text-fg-muted">…</span>
        ) : runs.length ? (
          <select aria-label="اختار التشغيل" value={pick} onChange={(e) => setPick(e.target.value)} className="min-h-10 max-md:min-h-[44px] min-w-0 flex-1 basis-48 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg">
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {when(r.startedAt)} — {RUN_AR[r.status] ?? r.status}
                {r.summary ? ` — ${r.summary.slice(0, 40)}` : ""}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-xs text-fg-muted">ما في تشغيل مسجّل فيه خطوات لسا — أول ما Claude يسجّل تشغيل بخطواته بتقدر تعيد عرضه.</span>
        )}
        <button type="button" className={cn(btn, "ms-auto")} aria-label="سكّر إعادة العرض" onClick={onClose}>
          <X className="size-4" />
        </button>
      </div>
      {run ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={btn} aria-label="الفرع اللي قبل" disabled={frame <= 0} onClick={() => { setPlaying(false); setFrame((f) => Math.max(0, f - 1)); }}>
              <ChevronRight className="size-4" />
            </button>
            <button
              type="button"
              className={cn(btn, "bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg")}
              aria-label={playing ? "وقّف" : "شغّل"}
              disabled={!last}
              onClick={() => {
                if (!playing && frame >= last) setFrame(0);
                setPlaying((p) => !p);
              }}
            >
              {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
            </button>
            <button type="button" className={btn} aria-label="الفرع اللي بعد" disabled={frame >= last} onClick={() => { setPlaying(false); setFrame((f) => Math.min(last, f + 1)); }}>
              <ChevronLeft className="size-4" />
            </button>
            <input type="range" min={0} max={last} step={1} value={frame} disabled={!last} aria-label="مكانك بالتشغيل" onChange={(e) => { setPlaying(false); setFrame(Number(e.target.value)); }} className="min-w-0 flex-1 basis-40 accent-accent" />
            <span dir="ltr" className="shrink-0 tabular-nums text-xs text-fg-muted">
              {frame}/{last}
            </span>
          </div>
          <p role="status" aria-live="polite" className="text-sm font-medium text-fg">
            {replayCaption(events, frame)}
            {frame > 0 && events[frame - 1] ? <span className="ms-2 text-xs font-normal text-fg-muted">{when(events[frame - 1]!.at)}</span> : null}
          </p>
          {frame > 0 && events[frame - 1]?.note ? <p className="text-xs text-fg-muted">{events[frame - 1]!.note}</p> : null}
          <p className="text-xs leading-5 text-fg-muted">
            الترتيب حسب وقت آخر حالة سجّلتها كل خطوة، و«عم يشتغل» بين خطوتين تقدير (التشغيل ما سجّل بداية الخطوة).
            {unknown ? ` ${unknown} فرع بالتشغيل مش موجودة بهالرسم (نسخة أقدم) فما انعرضت.` : ""}
          </p>
        </>
      ) : null}
    </section>
  );
}
