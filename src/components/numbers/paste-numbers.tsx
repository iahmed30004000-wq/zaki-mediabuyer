"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { PASTE_LEVELS, type PushLevel } from "@/core/push-rows";
import { safeFetch } from "@/lib/call";
import { cn } from "@/lib/utils";

const LEVEL_AR: Record<PushLevel, string> = { account: "حساب", campaign: "حملات", adset: "مجموعات", ad: "إعلانات", product: "منتجات", person: "موظفين" };

interface Preview {
  delimiter: string;
  mapped: { header: string; field: string }[];
  unmapped: string[];
  valid: number;
  problems: { line: number; error: string }[];
  problemCount: number;
  sample: Record<string, unknown>[];
}

const field = "min-h-10 max-md:min-h-[44px] w-full rounded-lg border border-border bg-surface-1 px-3 text-sm text-fg";

/**
 * «ألصق أرقام»: paste a table (an Ads Manager export, a sheet), look at what was understood, and enter the rows that are fine.
 * The reading and every check happen on the server (the code reads; nothing is guessed): this only shows the answer.
 */
export function PasteNumbers({ defaultDay }: { defaultDay: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [day, setDay] = useState(defaultDay);
  const [level, setLevel] = useState<PushLevel>("ad");
  const [busy, setBusy] = useState(false);
  const [pre, setPre] = useState<Preview | null>(null);

  async function call(apply: boolean) {
    setBusy(true);
    const r = await safeFetch("/api/numbers/paste", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, day, level, apply }) }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as Partial<Preview> & { error?: string; demo?: boolean; applied?: number; rejected?: number; rejectedList?: { line: number; error: string }[]; warnings?: string[] };
    setBusy(false);
    if (!r || !r.ok) return toast(d?.error ?? "صار خطأ، جرّب كمان مرة", "error");
    setPre(d as Preview);
    if (!apply) return;
    if (d.demo) return toast("بالوضع التجريبي ما بينحفظ شي — هاي معاينة بس", "info");
    toast(`انحفظ ${d.applied ?? 0} صف${d.rejected ? ` · ${d.rejected} انرفض` : ""}${d.warnings?.length ? ` · ${d.warnings[0]}` : ""}`, d.rejected ? "info" : "success");
    if (d.rejected) {
      // keep the sheet open on what was refused, with the reason — the rows that were fine are already in
      setPre({ ...(d as Preview), valid: 0, problems: d.rejectedList ?? [], problemCount: d.rejected });
      router.refresh();
      return;
    }
    setOpen(false);
    setText("");
    setPre(null);
    router.refresh();
  }

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)} data-tour="paste">
        <ClipboardPaste className="size-4" />
        ألصق أرقام
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>ألصق أرقام</SheetTitle>
            <SheetDescription>انسخ جدول من Ads Manager أو من شيت والصقه هون — الكود بيقراه، وإنت بتشوف شو انفهم قبل ما ينحفظ شي.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <textarea
              value={text}
              dir="auto"
              rows={7}
              maxLength={200_000}
              onChange={(e) => {
                setText(e.target.value);
                setPre(null);
              }}
              aria-label="الجدول الملصوق"
              placeholder={"Day, Ad ID, Ad name, Amount spent, Impressions, Link clicks, Purchases\n2026-11-14, 120001, TIN_V01, 12.50, 3400, 85, 2"}
              className={cn(field, "py-2 tabular-nums text-xs leading-6")}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-fg">مستوى الأسطر</span>
                <select value={level} onChange={(e) => { setLevel(e.target.value as PushLevel); setPre(null); }} className={field}>
                  {PASTE_LEVELS.map((l) => (
                    <option key={l} value={l}>{LEVEL_AR[l]}</option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-semibold text-fg">اليوم (إذا ما في عمود تاريخ)</span>
                <input type="date" value={day} dir="ltr" onChange={(e) => { setDay(e.target.value); setPre(null); }} className={field} />
              </label>
            </div>
            <p className="text-xs leading-5 text-fg-muted">لازم عمود معرّف (Ad ID أو Campaign ID …) — الموقع ما بيخمّن معرّف. الإعلان بدو أبوه معروف: الصق الحملات أول، بعدين المجموعات، بعدين الإعلانات (وإذا الملف فيه عمود Ad set ID بيستعمله). أرقام الـ OMS وميتا لما تنربط بتحل مكان الملصوق.</p>

            {pre ? (
              <div className="space-y-2 rounded-xl border border-border bg-surface-2/50 p-3 text-xs leading-6" role="status">
                <p className="text-sm font-semibold text-fg">
                  {pre.valid} صف صالح{pre.problemCount ? ` · ${pre.problemCount} فيها مشكلة` : ""}
                </p>
                {pre.mapped.length ? <p className="text-fg-muted">فهمت الأعمدة: {pre.mapped.map((m) => m.header).join("، ")}</p> : null}
                {pre.unmapped.length ? <p className="text-warn">تركت أعمدة ما بعرفها: {pre.unmapped.join("، ")}</p> : null}
                {pre.problems.slice(0, 8).map((p, i) => (
                  <p key={i} className="text-danger">
                    {p.line ? `سطر ${p.line}: ` : ""}
                    {p.error}
                  </p>
                ))}
                {pre.problemCount > 8 ? <p className="text-fg-muted">… و{pre.problemCount - 8} غيرها</p> : null}
                {pre.sample.length ? (
                  <ul className="space-y-1 text-fg">
                    {pre.sample.map((r, i) => (
                      <li key={i} dir="ltr" className="truncate text-start tabular-nums text-xs">
                        {String(r.date)} · {String(r.level)} · {String(r.id)}
                        {r.name ? ` · ${String(r.name)}` : ""}
                        {r.spend !== undefined ? ` · $${String(r.spend)}` : ""}
                        {r.impressions !== undefined ? ` · ${String(r.impressions)} imp` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" disabled={busy || !text.trim()} onClick={() => void call(false)}>
                شوف شو انفهم
              </Button>
              <Button size="sm" disabled={busy || !pre || !pre.valid} onClick={() => void call(true)}>
                {pre?.valid ? `ادخل ${pre.valid} صف` : "ادخل"}
              </Button>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
