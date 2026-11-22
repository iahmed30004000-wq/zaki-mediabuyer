"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Checkbox } from "@/components/ui/checkbox";
import { JobNumber } from "@/components/ui/job-number";
import { useToast } from "@/components/ui/toast";
import { callJson } from "@/lib/call";

export interface TidyJob {
  key: string;
  name: string;
  number: number | null;
}
export interface TidyPair {
  keep: TidyJob;
  drop: TidyJob;
  /** why they look the same, in words */
  why: string;
}

interface Answer {
  merged?: number;
  archived?: number;
  refused?: string[];
  demo?: boolean;
}

/**
 * «نظّف المكرّر» (docs/rebuild-v6/02-screens.md §3.3): the site suggests the pairs that look like one job written twice and the jobs it planted that never ran; the owner ticks «هاي هي» for
 * each pair he agrees with, and one press merges them (the second joins the first and keeps its history in it), puts away what never ran, and numbers the map 1…N. Nothing is deleted.
 */
export function TidyPanel({ pairs, neverRun }: { pairs: TidyPair[]; neverRun: TidyJob[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [merge, setMerge] = useState<Set<number>>(new Set());
  const [archive, setArchive] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const toggle = <T,>(s: Set<T>, v: T, on: boolean): Set<T> => {
    const n = new Set(s);
    if (on) n.add(v);
    else n.delete(v);
    return n;
  };
  const picked = merge.size + archive.size;

  async function run() {
    setBusy(true);
    try {
      const r = await callJson<Answer>("/api/jobs/tidy", { method: "POST", body: { merges: [...merge].map((i) => ({ keep: pairs[i]!.keep.key, drop: pairs[i]!.drop.key })), archive: [...archive], renumber: true } });
      if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
      if (r.data?.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
      const d = r.data ?? {};
      toast(`انضمّ ${d.merged ?? 0} · انأرشف ${d.archived ?? 0}${d.refused?.length ? ` · انرفض ${d.refused.length}` : ""}`, d.refused?.length ? "info" : "success");
      router.replace("/tasks/all");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="نظّف المكرّر" className="space-y-4 rounded-2xl border border-border bg-surface-1 p-4">
      <h2 className="font-display text-lg font-extrabold text-fg">نظّف المكرّر</h2>
      {pairs.length === 0 && neverRun.length === 0 ? <p className="text-base text-fg-muted">ما في شي مكرّر ولا مهمة ما اشتغلت. الخريطة نضيفة.</p> : null}
      {pairs.length ? (
        <div className="space-y-2">
          <p className="text-base text-fg-muted">هاي مهام شكلها نفس الشي مكتوب مرتين. اختار اللي إنت متأكد منهم: التانية بتنضم للأولى وبيضل كل تاريخها.</p>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {pairs.map((p, i) => (
              <li key={`${p.keep.key}:${p.drop.key}`} className="flex flex-wrap items-center gap-3 py-3">
                <Checkbox aria-label={`هاي هي: ${p.drop.name} نفس ${p.keep.name}`} checked={merge.has(i)} onChange={(e) => setMerge((s) => toggle(s, i, e.target.checked))} label="هاي هي" />
                <span className="flex min-w-0 flex-1 flex-wrap items-center gap-2 text-base">
                  <JobNumber n={p.drop.number} className="size-8 text-sm" />
                  <b className="font-semibold text-fg">{p.drop.name}</b>
                  <span className="text-fg-muted">بتنضم لـ</span>
                  <JobNumber n={p.keep.number} className="size-8 text-sm" />
                  <b className="font-semibold text-fg">{p.keep.name}</b>
                </span>
                <span className="text-sm text-fg-muted">{p.why}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {neverRun.length ? (
        <div className="space-y-2">
          <p className="text-base text-fg-muted">هاي مهام انحطّت من أول مرة وما اشتغلت ولا مرة. أرشفها بتخبّيها (ما بتنحذف).</p>
          <ul className="m-0 list-none divide-y divide-border p-0">
            {neverRun.map((j) => (
              <li key={j.key} className="flex items-center gap-3 py-2">
                <Checkbox aria-label={`أرشف ${j.name}`} checked={archive.has(j.key)} onChange={(e) => setArchive((s) => toggle(s, j.key, e.target.checked))} label="أرشفها" />
                <JobNumber n={j.number} className="size-8 text-sm" />
                <b className="min-w-0 flex-1 text-base font-semibold text-fg">{j.name}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={busy} disabled={!picked} onClick={() => void run()}>
          نظّف ({picked})
        </Button>
        <ButtonLink href="/tasks/all" variant="ghost">
          سكّر
        </ButtonLink>
        <span className="text-base text-fg-muted">بعد التنظيف بتتعدّل الأرقام 1…N.</span>
      </div>
    </section>
  );
}
