"use client";

import { useState } from "react";
import { Download, FileUp, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { Panel } from "@/components/mb/section";
import { FIELDS, FIELD_AR, REQUIRED, type Field } from "@/io/import";
import { cn } from "@/lib/utils";

interface Preview {
  headers: string[];
  mapping: Partial<Record<Field, number>>;
  rows: number;
  unknownAds: number;
  already: { at: string; rows: number } | null;
  errors: string[];
  preview: { day: string; ad: string; spend: number; impressions: number; purchases: number; known: boolean }[];
}

/** S13: a file from Ads Manager → its columns (guessed, changeable) → a preview → import. Same file twice = once. */
export function ImportPanel() {
  const { toast } = useToast();
  const [file, setFile] = useState<{ name: string; text?: string; base64?: string } | null>(null);
  const [p, setP] = useState<Preview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<Field, number>>>({});
  const [busy, setBusy] = useState(false);

  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    try {
      const r = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = (await r.json()) as Preview & { error?: string; message?: string; ok?: boolean };
      if (!r.ok) {
        toast(j.error ?? "ما زبط", "error");
        return null;
      }
      return j;
    } finally {
      setBusy(false);
    }
  };

  const pick = async (f: File) => {
    const isXlsx = /\.xlsx$/i.test(f.name);
    const loaded = isXlsx ? { name: f.name, base64: btoa(Array.from(new Uint8Array(await f.arrayBuffer()), (b) => String.fromCharCode(b)).join("")) } : { name: f.name, text: await f.text() };
    setFile(loaded);
    const j = await send({ fileName: loaded.name, text: loaded.text, base64: loaded.base64 });
    if (j) {
      setP(j);
      setMapping(j.mapping);
    }
  };

  const recheck = async (next: Partial<Record<Field, number>>) => {
    setMapping(next);
    if (!file) return;
    const j = await send({ fileName: file.name, text: file.text, base64: file.base64, mapping: next });
    if (j) setP(j);
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_16rem]">
      <Panel className="space-y-3">
        <p className="text-sm font-semibold text-fg">استيراد من مدير الإعلانات</p>
        <p className="text-xs text-fg-muted">تقرير يومي على مستوى الإعلان (CSV أو Excel، عربي أو إنجليزي): اليوم · رقم الإعلان أو اسمه · المبلغ المصروف · مرات الظهور، والباقي إذا موجود. مفيد للأيام اللي قبل الربط.</p>
        <label className={cn("flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border text-sm text-fg hover:border-accent/50", busy && "opacity-50")}>
          <FileUp className="size-4" /> {file ? file.name : "اختار الملف"}
          <input type="file" accept=".csv,.xlsx,text/csv" className="hidden" disabled={busy} onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {p ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {FIELDS.map((f) => (
                <label key={f}>
                  <Label>{FIELD_AR[f]}{REQUIRED.includes(f) ? " *" : ""}</Label>
                  <Select value={mapping[f] ?? ""} onChange={(e) => { const next = { ...mapping }; if (e.target.value === "") delete next[f]; else next[f] = Number(e.target.value); recheck(next); }}>
                    <option value="">—</option>
                    {p.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                  </Select>
                </label>
              ))}
            </div>
            {p.errors.length ? <ul className="space-y-1 rounded-lg bg-warn/10 p-2 text-xs text-fg">{p.errors.map((e) => <li key={e}>{e}</li>)}</ul> : null}
            {p.already ? <p className="rounded-lg bg-surface-2 p-2 text-xs text-fg-muted">هالملف انستورد قبل ({p.already.rows} سطر) — استيراده مرة تانية ما بيغيّر شي.</p> : null}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-fg-muted"><tr><th className="py-1 text-start font-medium">اليوم</th><th className="py-1 text-start font-medium">الإعلان</th><th className="py-1 text-start font-medium">الصرف</th><th className="py-1 text-start font-medium">الظهور</th><th className="py-1 text-start font-medium">شراء</th></tr></thead>
                <tbody>
                  {p.preview.map((r, i) => (
                    <tr key={i} className={cn("border-t border-border", !r.known && "text-fg-muted line-through")}>
                      <td dir="ltr" className="py-1 text-start">{r.day}</td><td dir="ltr" className="py-1 text-start font-mono">{r.ad}</td><td className="py-1">{r.spend}</td><td className="py-1">{r.impressions}</td><td className="py-1">{r.purchases}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                disabled={busy || !p.rows || p.errors.some((e) => !e.includes("مكرر"))}
                className="min-h-10"
                onClick={async () => {
                  const j = (await send({ fileName: file!.name, text: file!.text, base64: file!.base64, mapping, commit: true })) as { message?: string } | null;
                  if (j) {
                    toast(j.message ?? "انستورد", "success");
                    setP(null);
                    setFile(null);
                  }
                }}
              >
                <Upload className="size-4" /> استورد {p.rows} سطر
              </Button>
              {p.unknownAds ? <span className="text-xs text-fg-muted">{p.unknownAds} سطر لإعلانات مش معروفة عنا (مشطوبة) — ما رح ينحفظوا</span> : null}
            </div>
          </>
        ) : null}
      </Panel>
      <a href="/api/export" className="flex min-h-11 items-center justify-center gap-2 self-start rounded-lg border border-border bg-surface-1 text-sm font-medium text-fg hover:bg-surface-2">
        <Download className="size-4" /> تصدير Excel (مع شرح كل مؤشر)
      </a>
    </div>
  );
}
