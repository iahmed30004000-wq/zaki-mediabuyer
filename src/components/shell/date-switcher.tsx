"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarRange } from "lucide-react";
import { Input } from "@/components/ui/input";
import { RANGE_AR, type Range, type RangeKey } from "@/core/dates";
import { cn } from "@/lib/utils";

const CHOICES: RangeKey[] = ["today", "yesterday", "7d", "custom"];

/**
 * The one date switcher of the app: اليوم / امبارح / 7 أيام / مخصص. The choice lives in the address (`?d=…&from=…&to=…`),
 * so the back button, a shared link and a refresh all land on the same days — and every screen that reads it agrees.
 */
export function DateSwitcher({ range }: { range: Range }) {
  const router = useRouter();
  const path = usePathname() ?? "/";
  const params = useSearchParams();
  const [custom, setCustom] = useState(range.key === "custom");
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  const go = (next: Record<string, string | null>) => {
    const q = new URLSearchParams(params?.toString() ?? "");
    for (const [k, v] of Object.entries(next)) (v === null ? q.delete(k) : q.set(k, v));
    router.replace(`${path}?${q.toString()}`, { scroll: false });
  };

  return (
    <div className="space-y-2" data-tour="range">
      <div role="radiogroup" aria-label="الفترة" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-surface-1 p-1">
        {CHOICES.map((k) => {
          const on = k === "custom" ? custom || range.key === "custom" : range.key === k && !custom;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                if (k === "custom") return setCustom(true);
                setCustom(false);
                go({ d: k === "today" ? null : k, from: null, to: null });
              }}
              className={cn("inline-flex min-h-10 max-md:min-h-[44px] shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium", on ? "bg-accent text-accent-fg" : "text-fg-muted hover:text-fg")}
            >
              {k === "custom" ? <CalendarRange className="size-3.5" /> : null}
              {RANGE_AR[k]}
            </button>
          );
        })}
      </div>
      {custom ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
          من
          <Input type="date" dir="ltr" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="w-40" aria-label="من" />
          لـ
          <Input type="date" dir="ltr" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" aria-label="لـ" />
          <button type="button" disabled={!from || !to} onClick={() => go({ d: "custom", from, to })} className="min-h-10 max-md:min-h-[44px] rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-50">
            اعرض
          </button>
        </div>
      ) : null}
    </div>
  );
}
