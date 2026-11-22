"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Segmented } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/card";
import type { JobCounters } from "@/core/jobs";
import { DOMAIN_AR } from "@/core/jobs";
import type { JobView } from "@/lib/jobs-view";
import { DecisionSheet } from "./decision-sheet";
import { JobCard } from "./job-card";

const TILES: { key: keyof Pick<JobCounters, "running" | "problem" | "upcoming" | "manual" | "off">; label: string; tone: string }[] = [
  { key: "running", label: "مفعّلة", tone: "text-ok" },
  { key: "problem", label: "مشكلة", tone: "text-danger" },
  { key: "upcoming", label: "جاية", tone: "text-warn" },
  { key: "manual", label: "عند الطلب", tone: "text-fg" },
  { key: "off", label: "مطفية أو خلصت", tone: "text-fg-muted" },
];

/**
 * The map: five counters on top (running · a problem · coming · on request · off), then two columns — ads, and team and operations.
 * On a phone one column at a time, with a switch. A job with no number yet goes at the end of its column.
 */
export function WorkMap({ jobs, counters, canDecide = false }: { jobs: JobView[]; counters: JobCounters; canDecide?: boolean }) {
  const [domain, setDomain] = useState<"ads" | "ops">("ads");
  const [sheet, setSheet] = useState(false);
  const col = (d: "ads" | "ops") => jobs.filter((j) => j.domain === d);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {canDecide ? (
          <Button variant={sheet ? "primary" : "secondary"} size="sm" aria-pressed={sheet} onClick={() => setSheet((v) => !v)}>
            ورقة القرار
          </Button>
        ) : null}
        <ButtonLink href="/print/work" variant="secondary" size="sm" target="_blank">
          نسخة للطباعة
        </ButtonLink>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5" data-tour="counters">
        {TILES.map((t) => (
          <div key={t.key} className="rounded-card border border-border bg-surface-1 p-3">
            <p className="text-xs font-semibold text-fg-muted">{t.label}</p>
            <p dir="ltr" className={`font-display text-3xl font-extrabold tabular-nums ${t.tone}`}>
              {counters[t.key]}
            </p>
          </div>
        ))}
      </div>

      {sheet ? (
        <DecisionSheet jobs={jobs} onClose={() => setSheet(false)} />
      ) : jobs.length === 0 ? (
        <EmptyState title="ما في مهام مجدولة" hint="Claude لسا ما بعت خريطة مهامه — لما يبعتها بتشوفها هون بأرقامها." />
      ) : (
        <>
          <Segmented
            className="md:hidden"
            label="المجال"
            value={domain}
            onChange={setDomain}
            options={[
              { value: "ads", label: `${DOMAIN_AR.ads} (${col("ads").length})` },
              { value: "ops", label: `${DOMAIN_AR.ops} (${col("ops").length})` },
            ]}
          />
          <div className="grid gap-5 md:grid-cols-2">
            {(["ads", "ops"] as const).map((d) => (
              <section key={d} aria-label={DOMAIN_AR[d]} className={`space-y-3 ${domain === d ? "" : "max-md:hidden"}`}>
                <h2 className="hidden text-base font-extrabold text-fg md:block">
                  {DOMAIN_AR[d]} <span className="text-sm font-semibold text-fg-muted">({col(d).length})</span>
                </h2>
                {col(d).map((j) => (
                  <JobCard key={j.key} job={j} />
                ))}
                {!col(d).length ? <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في مهام بهالمجال.</p> : null}
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
