"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { Archive, CalendarClock, Combine, Flame, Link2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { PEOPLE, PRIORITIES, TASK_BOARDS, TASK_COLUMNS, assigneeName, dueState, duplicateGroups, groupByStatus, type TaskColumn } from "@/core/tasks";
import { cn } from "@/lib/utils";
import type { TaskView } from "@/server/tasks";

const DUE_STYLE = { late: "bg-danger/10 text-danger", today: "bg-warn/10 text-warn", soon: "bg-surface-2 text-fg" } as const;
const DUE_LABEL = { late: "متأخرة", today: "اليوم", soon: "قريب" } as const;
const field = "min-h-10 w-full rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg disabled:opacity-60";

/** Where a task's link leads: the page the thing lives on. */
function linkOf(t: TaskView): { href: string; label: string } | null {
  if (!t.linkType) return null;
  const id = t.linkId ?? "";
  const label = { workflow: "ورك فلو", approval: "قرار", video: "فيديو", campaign: "حملة", product: "منتج" }[t.linkType] ?? t.linkType;
  const href =
    t.linkType === "workflow" ? "/workflow" : t.linkType === "approval" ? "/tasks#approval" : t.linkType === "video" ? "/videos" : t.linkType === "campaign" ? `/ads?open=${encodeURIComponent(id)}` : t.linkType === "product" ? `/ads?product=${encodeURIComponent(id)}` : "";
  return href ? { href, label: id ? `${label} ${id}` : label } : null;
}

const dayText = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}/${Number(m)}`;
};

function Card({ t, canEdit, selected, now, onToggle, onOpen }: { t: TaskView; canEdit: boolean; selected: boolean; now: Date; onToggle: () => void; onOpen: () => void }) {
  const due = dueState(t.dueAt, t.status, now);
  const link = linkOf(t);
  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
      className={cn("rounded-lg border bg-surface-2/50 p-2.5", selected ? "border-accent" : "border-border", canEdit && "cursor-grab active:cursor-grabbing")}
    >
      <div className="flex items-start gap-2">
        {canEdit ? <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`حدّد: ${t.title}`} className="mt-1 size-4 shrink-0 accent-[var(--accent,#2563eb)]" /> : null}
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-start text-sm leading-5 text-fg hover:text-accent">
          {t.title}
        </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
        {t.priority === "urgent" || t.priority === "high" ? (
          <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold", t.priority === "urgent" ? "bg-danger/10 text-danger" : "bg-warn/10 text-warn")}>
            <Flame className="size-3" />
            {t.priority === "urgent" ? "عاجل" : "مهم"}
          </span>
        ) : null}
        {t.assignee ? <span className="rounded-md bg-accent/10 px-1.5 py-0.5 font-medium text-accent">{assigneeName(t.assignee)}</span> : <span className="rounded-md border border-dashed border-border px-1.5 py-0.5 text-fg-muted">بلا مسؤول</span>}
        {t.dueAt ? (
          <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5", due ? DUE_STYLE[due] : "bg-surface-2 text-fg-muted")} title={due ? DUE_LABEL[due] : undefined}>
            <CalendarClock className="size-3" />
            <span dir="ltr">{dayText(t.dueAt)}</span>
            {due === "late" ? " · متأخرة" : ""}
          </span>
        ) : null}
        {link ? (
          <Link href={link.href} className="inline-flex items-center gap-0.5 rounded-md bg-surface-2 px-1.5 py-0.5 text-fg-muted hover:text-accent">
            <Link2 className="size-3" />
            {link.label}
          </Link>
        ) : null}
        {t.board !== "main" ? <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-fg-muted">{TASK_BOARDS.find((b) => b.key === t.board)?.label ?? t.board}</span> : null}
      </div>
    </article>
  );
}

/** One card in the sheet: its people, its date, its note — and the way out (archive; nothing is deleted). */
function Editor({ task, canEdit, onClose, onSave, onArchive }: { task: TaskView | null; canEdit: boolean; onClose: () => void; onSave: (patch: Record<string, unknown>) => Promise<void>; onArchive: () => Promise<void> }) {
  const [status, setStatus] = useState(task?.status ?? "new");
  const [assignee, setAssignee] = useState(task?.assignee ?? "");
  const [priority, setPriority] = useState(task?.priority ?? "normal");
  const [due, setDue] = useState(task?.dueAt?.slice(0, 10) ?? "");
  const [note, setNote] = useState(task?.note ?? "");
  const [busy, setBusy] = useState(false);
  const link = task ? linkOf(task) : null;
  return (
    <Sheet open={!!task} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {task ? (
          <>
            <SheetHeader>
              <SheetTitle>{task.title}</SheetTitle>
              <SheetDescription>
                {TASK_BOARDS.find((b) => b.key === task.board)?.label ?? task.board}
                {task.executor ? ` · ينفّذها ${assigneeName(task.executor)}` : ""}
                {link ? (
                  <>
                    {" · "}
                    <Link href={link.href} className="text-accent hover:underline">{link.label}</Link>
                  </>
                ) : null}
              </SheetDescription>
            </SheetHeader>
            <SheetBody className="space-y-3">
              <label className="block space-y-1 text-xs text-fg-muted">
                الحالة
                <select value={status} disabled={!canEdit} onChange={(e) => setStatus(e.target.value)} className={field}>
                  {TASK_COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1 text-xs text-fg-muted">
                المسؤول
                <select value={assignee} disabled={!canEdit} onChange={(e) => setAssignee(e.target.value)} className={field}>
                  <option value="">بلا مسؤول</option>
                  {PEOPLE.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1 text-xs text-fg-muted">
                  الأولوية
                  <select value={priority} disabled={!canEdit} onChange={(e) => setPriority(e.target.value)} className={field}>
                    {PRIORITIES.map((p) => (
                      <option key={p.key} value={p.key}>{p.label}</option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1 text-xs text-fg-muted">
                  الموعد
                  <Input type="date" dir="ltr" value={due} disabled={!canEdit} onChange={(e) => setDue(e.target.value)} />
                </label>
              </div>
              <label className="block space-y-1 text-xs text-fg-muted">
                ملاحظة
                <textarea value={note} disabled={!canEdit} onChange={(e) => setNote(e.target.value)} rows={4} maxLength={1000} className={cn(field, "py-2 leading-6")} />
              </label>
            </SheetBody>
            {canEdit ? (
              <SheetFooter>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onArchive();
                    setBusy(false);
                  }}
                >
                  <Archive className="size-4" />
                  أرشف
                </Button>
                <Button
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    await onSave({ status, ...(assignee ? { assignee } : {}), priority, due_at: due || null, ...(note.trim() ? { note: note.trim() } : {}) });
                    setBusy(false);
                  }}
                >
                  احفظ
                </Button>
              </SheetFooter>
            ) : null}
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * المهام: the team's board — جديد · شغّال · بانتظار موافقة · متوقف · خلص — with the operations boards as tabs, a one-line quick
 * add («بكرا لميوز: …»), selection for bulk moves, the duplicates worth merging, and drag between columns on a big screen
 * (a phone shows one column at a time). Nothing is deleted: «أرشف» hides a card, and a merge keeps what the others said.
 */
export function TasksBoard({ initial, canEdit, nowIso }: { initial: TaskView[]; canEdit: boolean; nowIso: string }) {
  const { toast } = useToast();
  const now = useMemo(() => new Date(nowIso), [nowIso]);
  const [tasks, setTasks] = useState(initial);
  const [board, setBoard] = useState("all");
  const [who, setWho] = useState("");
  const [col, setCol] = useState<TaskColumn>("new");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<TaskView | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const r = await fetch("/api/tasks", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setTasks(((await r.json()) as { tasks: TaskView[] }).tasks);
  }, []);

  /** Calls the API; an error is said in words and `null` comes back. */
  async function call(url: string, method: string, body?: unknown): Promise<Record<string, unknown> | null> {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }).catch(() => null);
    const d = ((await r?.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    if (!r || !r.ok) {
      toast((d.error as string | undefined) ?? "صار خطأ، جرّب كمان مرة", "error");
      return null;
    }
    if (d.demo) {
      toast("بدون تسجيل دخول ما بينحفظ شي", "info");
      return null;
    }
    return d;
  }

  const shown = useMemo(() => tasks.filter((t) => (board === "all" || t.board === board) && (!who || t.assignee === who)), [tasks, board, who]);
  const grouped = useMemo(() => groupByStatus(shown), [shown]);
  const dups = useMemo(() => duplicateGroups(shown), [shown]);
  const countOf = (b: string) => tasks.filter((t) => t.status !== "done" && (b === "all" || t.board === b)).length;

  async function quickAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const d = await call("/api/tasks", "POST", { text, ...(board !== "all" ? { board } : {}) });
    setBusy(false);
    if (!d) return;
    setTasks((l) => [d.task as TaskView, ...l]);
    setText("");
    toast("انضافت المهمة ✓", "success");
  }

  async function move(id: string, status: string) {
    const before = tasks;
    setTasks((l) => l.map((t) => (t.id === id ? { ...t, status } : t)));
    if (!(await call(`/api/tasks/${id}`, "PATCH", { status }))) setTasks(before);
  }

  async function save(id: string, patch: Record<string, unknown>) {
    const d = await call(`/api/tasks/${id}`, "PATCH", patch);
    if (!d) return;
    setTasks((l) => l.map((t) => (t.id === id ? (d.task as TaskView) : t)));
    setOpen(null);
    toast("انحفظت ✓", "success");
  }

  async function archive(id: string) {
    const d = await call(`/api/tasks/${id}`, "PATCH", { archived: true });
    if (!d) return;
    setTasks((l) => l.filter((t) => t.id !== id));
    setSel((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    setOpen(null);
    toast("انأرشفت — ما بتنحذف", "success");
  }

  async function bulk(patch: Record<string, unknown>, done: string) {
    const ids = [...sel];
    if (!ids.length) return;
    const d = await call("/api/tasks/bulk", "POST", { ids, ...patch });
    if (!d) return;
    setSel(new Set());
    await reload();
    toast(done, "success");
  }

  async function merge(keep: string, drop: string[]) {
    const d = await call("/api/tasks/merge", "POST", { keep, drop });
    if (!d) return;
    setSel(new Set());
    await reload();
    toast("اندمجت — المكرّرات انأرشفت وملاحظاتها عند الباقية", "success");
  }

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="space-y-3" data-tour="board">
      {canEdit ? (
        <form onSubmit={quickAdd} className="flex flex-wrap items-center gap-2" data-tour="quick">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="مهمة جديدة… مثلاً «بكرا لميوز: اعمل 4 هوكات للطنين #stock !عاجل»"
            aria-label="مهمة جديدة بسطر وحد"
            className="min-w-0 flex-1"
            maxLength={300}
          />
          <Button type="submit" disabled={busy || !text.trim()} className="min-h-10">
            <Plus className="size-4" />
            أضف
          </Button>
        </form>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="اللوحات" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-1 p-1">
          {[{ key: "all", label: "الكل" }, ...TASK_BOARDS].map((b) => (
            <button key={b.key} role="tab" aria-selected={board === b.key} onClick={() => setBoard(b.key)} className={cn("min-h-9 shrink-0 rounded-md px-3 text-sm font-medium", board === b.key ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}>
              {b.label}
              <span className="ms-1.5 text-[11px] opacity-80">{countOf(b.key)}</span>
            </button>
          ))}
        </div>
        <select aria-label="المسؤول" value={who} onChange={(e) => setWho(e.target.value)} className="min-h-9 shrink-0 rounded-lg border border-border bg-surface-1 px-2 text-sm text-fg">
          <option value="">كل الفريق</option>
          {PEOPLE.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
      </div>

      {dups.length && canEdit ? (
        <details className="rounded-lg border border-warn/40 bg-warn/5 p-3 text-sm">
          <summary className="cursor-pointer font-medium text-fg">في {dups.length} {dups.length === 1 ? "مجموعة" : "مجموعات"} مهام شبه بعض — بتدمجها؟</summary>
          <ul className="mt-2 space-y-2">
            {dups.map((g) => (
              <li key={g[0]!.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-xs leading-5 text-fg-muted">{g.map((t) => `«${t.title}»`).join(" · ")}</span>
                <Button size="sm" variant="secondary" onClick={() => void merge(g[0]!.id, g.slice(1).map((t) => t.id))}>
                  <Combine className="size-3.5" />
                  ادمجها
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {sel.size ? (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-surface-1 p-2 shadow-card" role="toolbar" aria-label="تعديل جماعي">
          <span className="text-sm font-semibold text-fg">{sel.size} محدّدة</span>
          <select aria-label="انقلها لـ" defaultValue="" onChange={(e) => e.target.value && void bulk({ status: e.target.value }, "انتقلت")} className="min-h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm">
            <option value="">انقلها لـ…</option>
            {TASK_COLUMNS.map((c) => (
              <option key={c.key} value={c.key}>{c.label}</option>
            ))}
          </select>
          <select aria-label="سلّمها لـ" defaultValue="" onChange={(e) => e.target.value && void bulk({ assignee: e.target.value }, "انسلّمت")} className="min-h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm">
            <option value="">سلّمها لـ…</option>
            {PEOPLE.map((p) => (
              <option key={p.key} value={p.key}>{p.label}</option>
            ))}
          </select>
          {sel.size > 1 ? (
            <Button size="sm" variant="secondary" onClick={() => void merge([...sel][0]!, [...sel].slice(1))}>
              <Combine className="size-3.5" />
              ادمجها
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => void bulk({ archived: true }, "انأرشفت — ما بتنحذف")}>
            <Archive className="size-3.5" />
            أرشف
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
            ألغِ التحديد
          </Button>
        </div>
      ) : null}

      <div role="tablist" aria-label="الأعمدة" className="flex gap-1 overflow-x-auto rounded-lg border border-border bg-surface-1 p-1 lg:hidden">
        {TASK_COLUMNS.map((c) => (
          <button key={c.key} role="tab" aria-selected={col === c.key} onClick={() => setCol(c.key)} className={cn("min-h-9 shrink-0 rounded-md px-3 text-sm font-medium", col === c.key ? "bg-accent text-accent-fg" : "text-fg-muted")}>
            {c.label}
            <span className="ms-1.5 text-[11px] opacity-80">{grouped[c.key].length}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-5">
        {TASK_COLUMNS.map((c) => (
          <section
            key={c.key}
            aria-label={c.label}
            onDragOver={(e) => canEdit && e.preventDefault()}
            onDrop={(e) => {
              if (!canEdit) return;
              e.preventDefault();
              const id = e.dataTransfer.getData("text/plain");
              const t = tasks.find((x) => x.id === id);
              if (t && t.status !== c.key) void move(id, c.key);
            }}
            className={cn("min-w-0 space-y-2 rounded-card border border-border bg-surface-1 p-2.5", col !== c.key && "hidden lg:block")}
          >
            <h3 className="flex items-center gap-2 px-1 text-sm font-semibold text-fg">
              {c.label}
              <span className="rounded-full bg-surface-2 px-2 text-xs text-fg-muted">{grouped[c.key].length}</span>
            </h3>
            {c.key === "waiting_approval" ? (
              <p className="px-1 text-[11px] leading-4 text-fg-muted">
                قرارات الإعلانات والصرف فوق، بـ «بانتظار موافقتك» — هون المهام اللي بتستنى موافقة غير هيك.
              </p>
            ) : null}
            {grouped[c.key].map((t) => (
              <Card key={t.id} t={t} canEdit={canEdit} selected={sel.has(t.id)} now={now} onToggle={() => toggle(t.id)} onOpen={() => setOpen(t)} />
            ))}
            {!grouped[c.key].length ? <p className="px-1 py-6 text-center text-xs text-fg-muted">فاضي</p> : null}
          </section>
        ))}
      </div>

      {!tasks.length ? <p className="rounded-lg border border-dashed border-border p-3 text-xs leading-5 text-fg-muted">ما في مهام لسا. اكتب أول وحدة فوق بسطر وحد: مين وإمتى وشو — «بكرا لميوز: اعمل 4 هوكات». أي مهمة بيطلبها Claude (أو هيرمز) بتنزل هون كمان.</p> : null}

      <Editor key={open?.id ?? "none"} task={open} canEdit={canEdit} onClose={() => setOpen(null)} onSave={(p) => save(open!.id, p)} onArchive={() => archive(open!.id)} />
    </div>
  );
}
