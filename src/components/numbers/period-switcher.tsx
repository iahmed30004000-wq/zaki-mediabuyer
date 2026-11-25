"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { PERIODS, PERIOD_AR, type PeriodKey } from "@/core/compare";

const OPTIONS = PERIODS.map((p) => ({ value: p, label: PERIOD_AR[p] }));

/**
 * The period of the numbers screens: «أمس مقابل اللي قبله» · «آخر 7 أيام» · «آخر 30 يوم» · مخصص (docs/rebuild-v6/04-numbers.md §2). The choice lives in the address (`?p=…&from=…&to=…`), so Back, a
 * refresh and a shared link all land on the same days. A window always ends yesterday: the day that is not finished never takes part in a comparison — the page says so in the line under the switcher.
 */
export function PeriodSwitcher({ period, from, to, yesterday }: { period: PeriodKey; from: string; to: string; /** the last day a range may reach (an Amman date) */ yesterday: string }) {
  const router = useRouter();
  const path = usePathname() ?? "/numbers";
  const [custom, setCustom] = useState(period === "custom");
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);

  const params = useSearchParams();
  // the market chosen stays while the period changes
  const market = params?.get("market");
  const go = (q: Record<string, string>) => router.replace(`${path}?${new URLSearchParams({ ...q, ...(market ? { market } : {}) }).toString()}`, { scroll: false });
  const choose = (p: PeriodKey) => {
    if (p === "custom") return setCustom(true);
    setCustom(false);
    go(p === "7" ? {} : { p });
  };

  return (
    <div className="space-y-2" data-tour="range">
      <Segmented<PeriodKey> label="الفترة" value={custom ? "custom" : period} onChange={choose} options={OPTIONS} className="max-w-full flex-wrap" />
      {custom ? (
        <div className="flex flex-wrap items-center gap-2 text-base text-fg-muted">
          من
          <Input type="date" dir="ltr" value={a} max={b} onChange={(e) => setA(e.target.value)} className="w-44" aria-label="من" />
          لـ
          <Input type="date" dir="ltr" value={b} min={a} max={yesterday} onChange={(e) => setB(e.target.value)} className="w-44" aria-label="لـ" />
          <Button size="sm" disabled={!a || !b} onClick={() => go({ p: "custom", from: a, to: b })}>
            اعرض
          </Button>
        </div>
      ) : null}
    </div>
  );
}
