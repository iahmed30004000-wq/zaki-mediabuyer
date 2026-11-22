"use client";

import Link from "next/link";
import { useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { TrendChart, type TrendEvent } from "@/components/ui/trend-chart";
import { dayAgoWords } from "@/core/chart-events";

export interface TrendMetric {
  key: string;
  /** the short word on the switch: «التكلفة» */
  short: string;
  /** the title of the chart: «تكلفة الطلب الحقيقي» */
  title: string;
  unit: "$" | "%" | "";
  /** 30 values, the oldest first (null: a day with no number) */
  values: readonly (number | null)[];
  /** why there is no line, in a sentence (shown when there are fewer than two numbers) */
  empty: string;
  /** the owner's break-even and target as lines: only the cost of an order has them, and only when he wrote them */
  breakEven?: number | null;
  target?: number | null;
}

export interface TrendMark {
  /** where the day sits in the 30 values (0 = the oldest) */
  index: number;
  text: string;
  href: string | null;
}

export interface TrendRest {
  day: string;
  text: string;
  href: string | null;
}

/**
 * THE BIG CHART of the summary (docs/rebuild-v6/04-numbers.md §5, §7): the number of the switch for 30 days, the owner's break-even and target lines when he wrote them, and what we did on the days —
 * numbered circles over the line, the same numbers in a list under it. The chart puts the event beside the number; it never says one caused the other. The days that did not get a circle (six at most)
 * are in «باقي اللي عملناه», newest first. Everything arrives computed: this picks which line to draw.
 */
export function TrendPanel({ metrics, marks, rest, today }: { metrics: readonly TrendMetric[]; marks: readonly TrendMark[]; rest: readonly TrendRest[]; /** the Amman date of today, for «قبل 3 أيام» */ today: string }) {
  const [key, setKey] = useState(metrics[0]?.key ?? "");
  const m = metrics.find((x) => x.key === key) ?? metrics[0];
  if (!m) return null;
  const drawn = m.values.filter((v) => v !== null).length >= 2;
  const events: TrendEvent[] = marks.map((k) => ({ index: k.index, text: k.text, href: k.href }));
  return (
    <section className="space-y-3 rounded-card border border-border bg-surface-1 p-4" aria-label={`${m.title} آخر 30 يوم`} data-tour="chart">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-extrabold text-fg">{m.title} — آخر 30 يوم</h2>
          <p className="text-sm text-fg-muted">الأقدم عاليمين وأمس عاليسار{m.unit === "$" ? " · الأرقام بالدولار" : ""}</p>
        </div>
        {metrics.length > 1 ? <Segmented label="الرقم" value={m.key} onChange={setKey} options={metrics.map((x) => ({ value: x.key, label: x.short }))} className="max-w-full flex-wrap" /> : null}
      </div>
      <TrendChart
        values={m.values}
        unit={m.unit}
        breakEven={m.breakEven ?? null}
        target={m.target ?? null}
        events={drawn ? events : []}
        label={`${m.title} آخر 30 يوم`}
        xLabels={{ oldest: "قبل 30 يوم", newest: "أمس" }}
        empty={m.empty}
      />
      {rest.length ? (
        <div className="space-y-1.5 border-t border-border pt-3">
          <h3 className="text-sm font-bold text-fg-muted">باقي اللي عملناه</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-base">
            {rest.map((r, i) => (
              <li key={`${r.day}-${i}`} className="flex flex-wrap items-baseline gap-x-3">
                <span className="w-24 shrink-0 text-sm text-fg-muted">{dayAgoWords(r.day, today)}</span>
                {r.href ? (
                  <Link href={r.href} className="min-w-0 text-fg hover:underline">
                    {r.text}
                  </Link>
                ) : (
                  <span className="min-w-0 text-fg">{r.text}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
