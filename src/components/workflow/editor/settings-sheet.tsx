"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { isValidCron, nextRuns } from "@/core/cron";
import { EXECUTORS, EXECUTOR_AR, PERMISSIONS, PERMISSION_AR, type Executor, type Permission } from "@/core/workflow";
import { cn } from "@/lib/utils";

export interface Meta {
  name: string;
  description: string;
  schedule: string;
  executor: Executor;
  permission: Permission;
  enabled: boolean;
}

const field = "min-h-10 max-md:min-h-[44px] w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-fg disabled:opacity-60";
const PRESETS: [string, string][] = [
  ["كل يوم 10:00", "0 10 * * *"],
  ["كل ساعة", "0 * * * *"],
  ["كل ساعة من 10 لـ 22", "0 10-22 * * *"],
  ["كل خميس 11:00", "0 11 * * 4"],
  ["يدوي (بلا جدولة)", ""],
];
const when = (d: Date) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(d);

/** The workflow's own settings: its name, when it runs (a cron on the Amman clock), who runs it, how risky it is, and its switch. A save here is not a new version of the drawing. */
export function SettingsSheet({ open, onClose, workflowKey, meta, canEdit, demo, onSaved }: { open: boolean; onClose: () => void; workflowKey: string; meta: Meta; canEdit: boolean; demo: boolean; onSaved: (m: Meta) => void }) {
  const { toast } = useToast();
  const [m, setM] = useState(meta);
  const [busy, setBusy] = useState(false);
  const cronOk = m.schedule.trim() === "" || isValidCron(m.schedule.trim());
  const next = useMemo(() => (m.schedule.trim() && isValidCron(m.schedule.trim()) ? nextRuns(m.schedule.trim(), new Date(), 3) : []), [m.schedule]);

  async function save() {
    if (!m.name.trim()) return toast("اكتب اسم للمهمة", "error");
    if (!cronOk) return toast("الجدولة لازم cron من 5 خانات", "error");
    if (demo) return toast("بالوضع التجريبي ما انحفظ شي", "info");
    setBusy(true);
    const r = await fetch(`/api/workflow/${workflowKey}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: m.name.trim(), description: m.description.trim() || null, schedule: m.schedule.trim() || null, executor: m.executor, permission: m.permission, enabled: m.enabled }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    toast("انحفظت الإعدادات", "success");
    onSaved({ ...m, name: m.name.trim(), description: m.description.trim(), schedule: m.schedule.trim() });
    onClose();
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>إعدادات المهمة</SheetTitle>
          <SheetDescription>الاسم والجدولة والصلاحية — مش جزء من الرسم، فما بتعمل نسخة جديدة</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-4">
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-fg">الاسم</span>
            <input value={m.name} disabled={!canEdit} onChange={(e) => setM({ ...m, name: e.target.value })} className={field} />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-fg">الوصف</span>
            <textarea value={m.description} disabled={!canEdit} rows={3} onChange={(e) => setM({ ...m, description: e.target.value })} className={cn(field, "py-2 leading-6")} />
          </label>

          <div className="space-y-1.5">
            <label htmlFor="wf-cron" className="text-xs font-semibold text-fg">متى بيشتغل (توقيت عمّان)</label>
            <input id="wf-cron" dir="ltr" value={m.schedule} disabled={!canEdit} placeholder="دقيقة ساعة يوم شهر يوم-بالأسبوع  مثل: 0 10 * * *" onChange={(e) => setM({ ...m, schedule: e.target.value })} className={cn(field, "font-mono", !cronOk && "border-danger")} />
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map(([label, cron]) => (
                <button key={label} type="button" disabled={!canEdit} onClick={() => setM({ ...m, schedule: cron })} className={cn("min-h-10 max-md:min-h-[44px] rounded-full border px-3 text-xs", m.schedule.trim() === cron ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>
                  {label}
                </button>
              ))}
            </div>
            {!cronOk ? <p className="text-xs text-danger">مش cron صحيح: خمس خانات (دقيقة ساعة يوم شهر يوم-بالأسبوع).</p> : next.length ? <p className="text-xs leading-5 text-fg-muted">الجاي: {next.map(when).join(" · ")}</p> : <p className="text-xs text-fg-muted">بلا جدولة: بيشتغل بإيدك («شغّل هلق») أو بحدث.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-fg">اللي بينفّذه</span>
              <select value={m.executor} disabled={!canEdit} onChange={(e) => setM({ ...m, executor: e.target.value as Executor })} className={field}>
                {EXECUTORS.map((x) => (
                  <option key={x} value={x}>{EXECUTOR_AR[x]}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-fg">الصلاحية</span>
              <select value={m.permission} disabled={!canEdit} onChange={(e) => setM({ ...m, permission: e.target.value as Permission })} className={field}>
                {PERMISSIONS.map((p) => (
                  <option key={p} value={p}>{PERMISSION_AR[p]}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="flex min-h-10 max-md:min-h-[44px] cursor-pointer items-center gap-2 text-sm text-fg">
            <input type="checkbox" checked={m.enabled} disabled={!canEdit} onChange={(e) => setM({ ...m, enabled: e.target.checked })} className="size-4 accent-accent" />
            شغّال (إذا انطفى Claude بيعرف من جواب log_run)
          </label>
        </SheetBody>
        <SheetFooter>
          <Button variant="ghost" onClick={onClose}>سكّر</Button>
          {canEdit ? <Button onClick={save} disabled={busy}>{busy ? "لحظة…" : "احفظ"}</Button> : null}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
