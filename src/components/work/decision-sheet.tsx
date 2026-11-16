"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pill } from "@/components/ui/pill";
import { useToast } from "@/components/ui/toast";
import type { JobView } from "@/lib/jobs-view";

type Choice = "keep" | "cancel";

/**
 * The decision sheet (docs/rebuild/04-work.md §4): every job and its branches in one table — # · job · when · state · the agent's advice ·
 * «خلّيها» · «ألغيها». «ابعت القرار» applies the whole sheet at once; Claude gets ONE message with the numbers («ألغي 7 · 8 · الفرع 11.3»).
 */
export function DecisionSheet({ jobs, onClose }: { jobs: JobView[]; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pick, setPick] = useState<Record<string, Choice>>({});
  const [off, setOff] = useState<Record<string, Record<string, boolean>>>({});
  const [busy, setBusy] = useState(false);

  const items = useMemo(
    () =>
      jobs
        .map((j) => {
          const branches = Object.fromEntries(Object.entries(off[j.key] ?? {}).filter(([, v]) => v).map(([id]) => [id, false]));
          const decision = pick[j.key] ?? (Object.keys(branches).length ? ("keep" as const) : undefined);
          return decision ? { key: j.key, decision, ...(Object.keys(branches).length ? { branches } : {}) } : null;
        })
        .filter((x): x is NonNullable<typeof x> => x !== null),
    [jobs, pick, off],
  );

  async function send() {
    setBusy(true);
    try {
      const r = await fetch("/api/work/decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      if (d.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
      toast("انبعت القرار ✓ — Claude رح يشيلها من جدولته", "success");
      router.refresh();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const set = (key: string, c: Choice, on: boolean) => setPick((p) => (on ? { ...p, [key]: c } : Object.fromEntries(Object.entries(p).filter(([k]) => k !== key))));

  return (
    <section aria-label="ورقة القرار" className="space-y-3">
      <div className="overflow-x-auto rounded-card border border-border bg-surface-1">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-xs font-bold text-fg-muted">
              <th className="h-10 w-10 px-3 text-start">#</th>
              <th className="px-3 text-start">المهمة</th>
              <th className="px-3 text-start">الموعد</th>
              <th className="px-3 text-start">الوضع</th>
              <th className="px-3 text-start">التوصية</th>
              <th className="w-20 px-3 text-center">خلّيها</th>
              <th className="w-20 px-3 text-center">ألغيها</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <Fragment key={j.key}>
                <tr className="border-t border-border align-middle">
                  <td dir="ltr" className="px-3 py-2 text-start font-extrabold tabular-nums">
                    {j.number ?? "·"}
                  </td>
                  <td className="px-3 py-2 font-bold text-fg">{j.name}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">{j.words}</td>
                  <td className="px-3 py-2">
                    <Pill tone={j.badge.tone}>{j.badge.label}</Pill>
                  </td>
                  <td className="px-3 py-2 text-xs text-fg-muted">{j.advice ? j.advice.label : "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <Checkbox aria-label={`خلّي ${j.name}`} checked={pick[j.key] === "keep"} onChange={(e) => set(j.key, "keep", e.target.checked)} className="justify-center" />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Checkbox aria-label={`ألغي ${j.name}`} checked={pick[j.key] === "cancel"} onChange={(e) => set(j.key, "cancel", e.target.checked)} className="justify-center" />
                  </td>
                </tr>
                {j.branches.map((b) => (
                  <tr key={b.id} className="border-t border-border/60 bg-surface-2/40 text-xs">
                    <td dir="ltr" className="px-3 py-1.5 text-start tabular-nums text-fg-muted">
                      {b.number ?? ""}
                    </td>
                    <td colSpan={4} className={b.disabled ? "px-3 py-1.5 text-fg-muted line-through" : "px-3 py-1.5 text-fg-muted"}>
                      {b.label}
                    </td>
                    <td />
                    <td className="px-3 py-1.5 text-center">
                      {b.disabled ? null : (
                        <Checkbox aria-label={`ألغي الفرع ${b.number ?? b.label}`} checked={!!off[j.key]?.[b.id]} onChange={(e) => setOff((o) => ({ ...o, [j.key]: { ...o[j.key], [b.id]: e.target.checked } }))} className="justify-center" />
                      )}
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={busy} disabled={!items.length} onClick={() => void send()}>
          ابعت القرار
        </Button>
        <Button variant="ghost" onClick={onClose}>
          سكّر الورقة
        </Button>
        <span className="text-sm text-fg-muted">{items.length ? `${items.length} مهمة بالقرار` : "اختار على الأقل مهمة أو فرع"}</span>
      </div>
    </section>
  );
}
