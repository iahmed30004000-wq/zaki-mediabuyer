"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import { LEVEL_AR, LEVEL_HINT } from "@/lib/mock/data";
import { cn } from "@/lib/utils";
import type { LevelRow } from "@/lib/settings-view";

/** One account's level (spec 10.1): the owner taps a level; a level it may not take says why instead. */
export function LevelPicker({ row }: { row: LevelRow }) {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  const router = useRouter();
  const pick = async (level: number) => {
    const o = row.options[level]!;
    if (level === row.level) return;
    if (!o.ok) {
      toast(o.why, "info");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch(`/api/accounts/${row.metaId}/level`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level }) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) toast(j.error ?? "ما زبط", "error");
      else {
        toast(`${row.name}: صار ${LEVEL_AR[level as 0 | 1 | 2 | 3]}`, "success");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-4 gap-1">
        {LEVEL_AR.map((l, i) => {
          const o = row.options[i]!;
          return (
            <button
              key={l}
              type="button"
              disabled={busy}
              title={o.ok ? LEVEL_HINT[i] : o.why}
              onClick={() => pick(i)}
              className={cn("min-h-9 rounded-md py-1 text-center text-[11px]", i === row.level ? "bg-accent text-accent-fg" : o.ok ? "bg-surface-2 text-fg hover:bg-accent/15" : "bg-surface-2 text-fg-muted/60")}
            >
              {l}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-fg-muted">{LEVEL_HINT[row.level as 0 | 1 | 2 | 3]}</p>
      {row.level < 2 && !row.options[2]!.ok ? <p className="text-[11px] text-fg-muted">للمكبّر المحدود: {row.options[2]!.why}</p> : null}
      {row.restricted ? <p className="text-[11px] text-danger">الحساب عليه تنبيه سلامة — المستوى الفعلي صفر</p> : null}
    </div>
  );
}
