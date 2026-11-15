"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { WORKFLOW_TEMPLATES } from "@/core/workflow-edit";
import { cn } from "@/lib/utils";

const field = "min-h-10 w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-fg";

/** «＋ ورك فلو جديد»: a name, and where to start — a template, or a copy of one that exists. It opens on its drawing board. */
export function NewWorkflow({ existing }: { existing: { key: string; name: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState("blank");
  const [copy, setCopy] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!name.trim()) return toast("اكتب اسم للورك فلو", "error");
    setBusy(true);
    const r = await fetch("/api/workflow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: name.trim(), ...(copy ? { copy_of: copy } : { template }) }) });
    const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean; workflow?: { key: string } };
    setBusy(false);
    if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
    if (d.demo || !d.workflow) return toast("بالوضع التجريبي ما انعمل شي", "info");
    toast("انعمل ✓ — هي لوحة الرسم", "success");
    router.push(`/workflow/${d.workflow.key}`);
  }

  return (
    <>
      <Button size="sm" variant="secondary" className="min-h-9" onClick={() => setOpen(true)} data-tour="new">
        <Plus className="size-4" /> ورك فلو جديد
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>ورك فلو جديد</SheetTitle>
            <SheetDescription>اسم، ومن وين تبدأ. بعدها بترسمه بالسحب.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-fg">الاسم</span>
              <input value={name} dir="auto" onChange={(e) => setName(e.target.value)} placeholder="مثلاً: متابعة طلبات الجمعة" className={field} />
            </label>
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold text-fg">ابدأ من قالب</legend>
              {WORKFLOW_TEMPLATES.map((t) => (
                <button key={t.id} type="button" aria-pressed={!copy && template === t.id} onClick={() => { setTemplate(t.id); setCopy(""); }} className={cn("flex min-h-12 w-full flex-col items-start rounded-xl border px-3 py-2 text-start", !copy && template === t.id ? "border-accent bg-accent/5" : "border-border")}>
                  <span className="text-sm font-semibold text-fg">{t.name}</span>
                  <span className="text-xs text-fg-muted">{t.about}</span>
                </button>
              ))}
            </fieldset>
            <label className="block space-y-1">
              <span className="text-xs font-semibold text-fg">أو انسخ ورك فلو موجود</span>
              <select value={copy} onChange={(e) => setCopy(e.target.value)} className={field}>
                <option value="">— لا، من قالب</option>
                {existing.map((w) => (
                  <option key={w.key} value={w.key}>{w.name}</option>
                ))}
              </select>
            </label>
          </SheetBody>
          <SheetFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button onClick={create} disabled={busy}>{busy ? "لحظة…" : "اعمله"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
