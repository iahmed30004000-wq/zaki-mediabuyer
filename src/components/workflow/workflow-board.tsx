"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, Hourglass, PencilRuler, Play, Radio, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { Panel } from "@/components/mb/section";
import { ASSIGNEES, waitingText } from "@/core/handoff";
import { isSiteExecutor } from "@/core/step-exec";
import { EXECUTOR_AR, type Executor } from "@/core/workflow";
import { cn } from "@/lib/utils";
import type { HandoffView } from "@/server/handoffs";
import type { RunView, WorkflowCard } from "@/server/workflows";
import { ExecutorBadge, PermBadge } from "./badges";
import { FlowStrip } from "./flow";
import { NewWorkflow } from "./new-workflow";

const RUN_AR: Record<string, { label: string; cls: string }> = {
  running: { label: "عم يشتغل", cls: "bg-accent/10 text-accent" },
  ok: { label: "خلص ✓", cls: "bg-ok/10 text-ok" },
  failed: { label: "فشل", cls: "bg-danger/10 text-danger" },
  waiting: { label: "متوقف — بانتظار", cls: "bg-warn/10 text-warn" },
  skipped: { label: "تخطّى", cls: "bg-surface-2 text-fg-muted" },
};
const FILTERS = [
  { key: "all", label: "الكل" },
  { key: "live", label: "شغّال هلأ" },
  { key: "failed", label: "فاشل أو متوقف" },
  { key: "off", label: "مطفي" },
] as const;

const time = (iso: string | null) => (iso ? new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "—");

/** «0 35 * * *» in words, from the next run it computes — the cron itself stays in the card's detail. */
function scheduleText(c: WorkflowCard) {
  if (!c.schedule) return "يدوي أو بحدث";
  return c.nextRun ? `الجاي: ${time(c.nextRun)}` : "مطفي";
}

function RunChip({ run }: { run: RunView | null }) {
  if (!run) return <span className="text-xs text-fg-muted">ما اشتغل لسا</span>;
  const s = RUN_AR[run.status] ?? { label: run.status, cls: "bg-surface-2 text-fg-muted" };
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className={cn("rounded-md px-1.5 py-0.5 font-semibold", s.cls)}>{s.label}</span>
      <span className="text-fg-muted">{time(run.startedAt)}</span>
      {run.summary ? <span className="text-fg">{run.summary}</span> : null}
    </span>
  );
}

function History({ workflowKey }: { workflowKey: string }) {
  const [status, setStatus] = useState("");
  const [runs, setRuns] = useState<RunView[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/workflow/${workflowKey}${status ? `?status=${status}` : ""}`)
      .then((r) => (r.ok ? r.json() : { runs: [] }))
      .then((d: { runs: RunView[] }) => alive && setRuns(d.runs))
      .catch(() => alive && setRuns([]));
    return () => {
      alive = false;
    };
  }, [workflowKey, status]);
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="سجل التشغيلات">
        {[["", "الكل"], ["ok", "خلص"], ["failed", "فشل"], ["waiting", "متوقف"]].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setStatus(k!)} className={cn("min-h-8 rounded-full border px-3 text-xs", status === k ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>
            {l}
          </button>
        ))}
      </div>
      {runs === null ? <p className="text-xs text-fg-muted">…</p> : runs.length ? (
        <ul className="divide-y divide-border">
          {runs.slice(0, 12).map((r) => (
            <li key={r.id} className="py-1.5">
              <RunChip run={r} />
            </li>
          ))}
        </ul>
      ) : <p className="text-xs text-fg-muted">ما في تشغيلات بهالفلتر.</p>}
    </div>
  );
}

function Card({ c, canEdit, handoff, onChanged }: { c: WorkflowCard; canEdit: boolean; handoff?: HandoffView; onChanged: () => void }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const live = c.live;
  const states = (live ?? c.lastRun)?.nodeStates ?? {};

  async function toggle() {
    setBusy(true);
    const r = await fetch(`/api/workflow/${c.key}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !c.enabled }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
    setBusy(false);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    toast(d.demo ? "بالوضع التجريبي ما تغيّر شي" : c.enabled ? "انطفى — Claude بيعرف من جواب log_run" : "انشغّل", d.demo ? "info" : "success");
    onChanged();
  }

  async function runNow() {
    setBusy(true);
    const r = await fetch(`/api/workflow/${c.key}/run`, { method: "POST" });
    const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; created?: boolean };
    setBusy(false);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    toast(d.demo ? "بالوضع التجريبي ما انبعت شي" : d.created === false ? "طلب التشغيل موجود من قبل — بانتظار Claude" : "انبعتت لـ Claude — بيبلّش أول ما يقرا طابور التسليم", d.demo ? "info" : "success");
    onChanged();
  }

  async function execute() {
    setBusy(true);
    const r = await fetch(`/api/workflow/${c.key}/execute`, { method: "POST" });
    const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; status?: "ok" | "waiting"; ran?: { status: string }[]; handedOver?: { label: string; why: string } };
    setBusy(false);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    if (d.demo) return toast("بالوضع التجريبي ما بينفّذ الموقع شي", "info");
    const n = d.ran?.filter((x) => x.status === "done").length ?? 0;
    toast(d.status === "ok" ? `خلصت من الموقع: ${n} خطوة ✓` : `نفّذ الموقع ${n} خطوة ووقف عند «${d.handedOver?.label}» — ${d.handedOver?.why}`, d.status === "ok" ? "success" : "info");
    onChanged();
  }

  const siteSteps = c.graph.nodes.some((n) => !n.disabled && isSiteExecutor(n.executor));

  return (
    <Panel className={cn("min-w-0 space-y-3", live && "border-accent/50")}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-fg">
            {live ? <Radio className="size-4 shrink-0 animate-pulse text-accent motion-reduce:animate-none" aria-label="شغّال هلأ" /> : null}
            <span className="truncate">{c.name}</span>
          </h3>
          <p className="text-xs leading-5 text-fg-muted">{c.description}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <PermBadge permission={c.permission as never} />
          <ExecutorBadge executor={c.executor as Executor} />
          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">{c.dataSource === "mcp" ? "Claude (MCP)" : c.dataSource === "api" ? "API" : "يدوي"}</span>
        </div>
      </div>

      <FlowStrip graph={c.graph} states={states} />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <span className="text-fg-muted">{scheduleText(c)}</span>
        <RunChip run={live ?? c.lastRun} />
        {handoff ? <span className="rounded-md bg-warn/10 px-1.5 py-0.5 font-semibold text-warn">متوقف — {handoff.assigneeLabel} بيكمّلها</span> : null}
        <span className="ms-auto flex items-center gap-2">
          {canEdit && c.enabled ? (
            <Button size="sm" variant="secondary" disabled={busy || !!handoff} onClick={runNow} aria-label={`شغّل ${c.name} هلق`}>
              <Play className="size-3.5" />
              شغّل هلق
            </Button>
          ) : null}
          {canEdit && c.enabled && siteSteps ? (
            <Button size="sm" variant="secondary" disabled={busy || !!handoff} onClick={execute} aria-label={`شغّل ${c.name} من الموقع`} title="الموقع بينفّذ الخطوات الخضرا اللي منفّذها n8n أو HTTP أو تيليجرام، وبيسلّم الباقي">
              <Zap className="size-3.5" />
              من الموقع
            </Button>
          ) : null}
          {canEdit ? (
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-2 text-fg-muted">
              <input type="checkbox" checked={c.enabled} disabled={busy} onChange={toggle} className="size-4 accent-[var(--accent,#2563eb)]" aria-label={`تشغيل ${c.name}`} />
              {c.enabled ? "شغّال" : "مطفي"}
            </label>
          ) : null}
          <Link href={`/workflow/${c.key}`} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={`${canEdit ? "عدّل رسم" : "افتح رسم"} ${c.name}`}>
            <PencilRuler className="size-3.5" />
            {canEdit ? "عدّل الرسم" : "الرسم"}
          </Link>
          <Button variant="ghost" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            السجل
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
          </Button>
        </span>
      </div>
      {open ? <History workflowKey={c.key} /> : null}
      {open && c.schedule ? <p dir="ltr" className="text-start font-mono text-[11px] text-fg-muted">cron (Asia/Amman): {c.schedule} · {EXECUTOR_AR[c.executor as Executor] ?? c.executor} · v{c.version}</p> : null}
    </Panel>
  );
}

/** One thing waiting for someone: what, since when, who has it, what is needed — and, for the owner, who it goes to instead. */
function HandoffLane({ items, canEdit, onChanged }: { items: HandoffView[]; canEdit: boolean; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, body: Record<string, unknown>, done: string) {
    setBusy(id);
    const r = await fetch(`/api/handoffs/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
    setBusy(null);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    toast(d.demo ? "بالوضع التجريبي ما تغيّر شي" : done, d.demo ? "info" : "success");
    onChanged();
  }

  return (
    <section aria-label="طابور التسليم" data-tour="handoffs" className="space-y-2 rounded-card border border-warn/40 bg-warn/5 p-3 sm:p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold text-fg">
        <Hourglass className="size-4 text-warn" />
        متوقف — بانتظار حدا يكمّلها
        <span className="rounded-full bg-warn/20 px-2 text-xs text-warn">{items.length}</span>
      </h2>
      <ul className="divide-y divide-warn/20">
        {items.map((h) => (
          <li key={h.id} className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-fg">{h.title}</span>
              <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-muted">{h.kindLabel}</span>
              <span className="text-xs text-fg-muted">{waitingText(h.waitingMin)}</span>
              <span className="ms-auto rounded-md bg-surface-1 px-1.5 py-0.5 text-[11px] font-semibold text-fg">
                {h.status === "claimed" ? `عند ${h.claimedBy ?? h.assigneeLabel}` : `مسلَّمة لـ ${h.assigneeLabel}`}
              </span>
            </div>
            <p className="text-xs leading-5 text-fg-muted">
              {h.workflowName ?? h.workflowKey}
              {h.context.need ? ` · المطلوب: ${h.context.need}` : ""}
            </p>
            {h.context.lastError ? <p className="text-xs leading-5 text-danger">آخر خطأ: {h.context.lastError}</p> : null}
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  سلّمها لـ
                  <select
                    aria-label={`سلّم «${h.title}» لـ`}
                    value={ASSIGNEES.some((a) => a.key === h.assignee) ? h.assignee : ""}
                    disabled={busy === h.id}
                    onChange={(e) => e.target.value && e.target.value !== h.assignee && void act(h.id, { action: "reassign", assignee: e.target.value }, "انسلّمت")}
                    className="min-h-8 rounded-lg border border-border bg-surface-1 px-2 text-xs text-fg"
                  >
                    {ASSIGNEES.some((a) => a.key === h.assignee) ? null : <option value="">{h.assigneeLabel}</option>}
                    {ASSIGNEES.map((a) => (
                      <option key={a.key} value={a.key}>{a.label}</option>
                    ))}
                  </select>
                </label>
                <Button size="sm" variant="ghost" disabled={busy === h.id} onClick={() => void act(h.id, { action: "cancel" }, "انلغت — انعلّم التشغيل «تخطّى»")}>
                  الغِها
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * الورك فلو: every job with its steps, who does it, when it runs next, and what came out last. While Claude is running
 * one (it reports with `log_run`) the card moves — the line before the working step flows, the step rings, a finished one
 * ticks, a failed one shakes. The open page asks every 5 seconds while a job is moving and every 30 otherwise (never in the
 * background).
 */
export function WorkflowBoard({ initial, initialHandoffs, demo, canEdit }: { initial: WorkflowCard[]; initialHandoffs: HandoffView[]; demo: boolean; canEdit: boolean }) {
  const [cards, setCards] = useState(initial);
  const [handoffs, setHandoffs] = useState(initialHandoffs);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const anyLive = useRef(false);

  const refresh = useCallback(async () => {
    if (demo || document.visibilityState !== "visible") return;
    try {
      const r = await fetch("/api/workflow/live", { cache: "no-store" });
      if (r.ok) {
        const d = (await r.json()) as { workflows: WorkflowCard[]; handoffs?: HandoffView[] };
        setCards(d.workflows);
        setHandoffs(d.handoffs ?? []);
      }
    } catch {
      // offline: the page keeps what it has
    }
  }, [demo]);
  anyLive.current = cards.some((c) => c.live);

  useEffect(() => {
    if (demo) return;
    let timer: ReturnType<typeof setTimeout>;
    const loop = () => {
      void refresh();
      timer = setTimeout(loop, anyLive.current ? 5_000 : 30_000);
    };
    timer = setTimeout(loop, 5_000);
    return () => clearTimeout(timer);
  }, [demo, refresh]);

  const shown = useMemo(
    () =>
      cards.filter((c) => {
        if (filter === "live") return !!c.live;
        if (filter === "failed") return (c.live ?? c.lastRun)?.status === "failed" || (c.live ?? c.lastRun)?.status === "waiting";
        if (filter === "off") return !c.enabled;
        return true;
      }),
    [cards, filter],
  );
  const moving = cards.filter((c) => c.live).length;

  return (
    <div className="space-y-4">
      {demo ? <p className="rounded-lg border border-dashed border-border p-3 text-xs leading-5 text-fg-muted">هاي المهام اللي بتشتغل (نظرة تجريبية: ما في تشغيلات). لما تربط Claude وتفتح الموقع على البيانات الحقيقية، كل تشغيل بيتحرك هون لحظة بلحظة.</p> : null}
      {handoffs.length ? <HandoffLane items={handoffs} canEdit={canEdit && !demo} onChanged={refresh} /> : null}
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="فلتر" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-1 p-1">
          {FILTERS.map((f) => (
            <button key={f.key} role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)} className={cn("min-h-9 shrink-0 rounded-md px-3 text-sm font-medium", filter === f.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}>
              {f.label}
              {f.key === "live" && moving ? <span className="ms-1.5 rounded-full bg-accent-fg/20 px-1.5 text-[11px]">{moving}</span> : null}
            </button>
          ))}
        </div>
        {canEdit ? <NewWorkflow existing={cards.map((c) => ({ key: c.key, name: c.name }))} /> : null}
        <span className="ms-auto inline-flex items-center gap-1.5 text-xs text-fg-muted">
          <Play className="size-3" />
          {cards.length} مهمة · {moving ? `${moving} شغّالة هلأ` : "ولا وحدة شغّالة هلأ"}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-[repeat(2,minmax(0,1fr))]">
        {shown.map((c) => (
          <Card key={c.key} c={c} canEdit={canEdit && !demo} handoff={handoffs.find((h) => h.workflowKey === c.key)} onChanged={refresh} />
        ))}
      </div>
      {!shown.length ? <p className="py-8 text-center text-sm text-fg-muted">ما في مهام بهالفلتر.</p> : null}
    </div>
  );
}
