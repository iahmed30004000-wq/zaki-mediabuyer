import Link from "next/link";
import { EmptyState } from "@/components/ui/card";
import { JobNumber } from "@/components/ui/job-number";
import { Pill } from "@/components/ui/pill";
import { StateWord } from "@/components/ui/state-word";
import { Lamp } from "@/components/ui/lamp";
import type { AllGroup, AllRow } from "@/core/tasks-view";
import { cn } from "@/lib/utils";
import { JobSwitch } from "./job-actions";

function Row({ r, canSwitch }: { r: AllRow; canSwitch: boolean }) {
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 py-3", !r.enabled && "opacity-70")}>
      {r.type === "job" ? <JobNumber n={r.number} /> : <span aria-hidden className="inline-flex size-9 shrink-0 items-center justify-center text-fg-muted">·</span>}
      <Link href={r.href} className="min-w-0 flex-1 basis-56">
        <b className="block text-base font-extrabold leading-6 text-fg">{r.name}</b>
        <span className="block text-base text-fg-muted">
          {r.when} · {r.who}
        </span>
      </Link>
      <Pill>{r.kindLabel}</Pill>
      {r.word ? (
        <StateWord state={r.word} who={r.who} />
      ) : r.type === "person" && r.lamp !== "off" ? (
        <span className="inline-flex items-center gap-1.5 text-sm font-bold text-fg-muted">
          <Lamp state={r.lamp} size={10} />
          {r.lamp === "fail" ? "متأخرة" : "اليوم"}
        </span>
      ) : null}
      {r.type === "job" ? <JobSwitch jobKey={r.key} enabled={r.enabled} canSwitch={canSwitch} /> : null}
    </li>
  );
}

/** «كل المهام»: one list in two groups (إعلانات · فريق وتشغيل) — the number, the name, when in words and who, the kind, the word of the last run, and the job's own switch. */
export function AllList({ groups, canSwitch }: { groups: readonly AllGroup[]; canSwitch: boolean }) {
  if (!groups.length) return <EmptyState title="ما في مهام بهالفلتر" hint="غيّر الفلتر فوق، أو شوف كل المهام." action={{ label: "كل المهام", href: "/tasks/all" }} />;
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <section key={g.domain} aria-label={g.label} className="space-y-2">
          <h2 className="font-display text-lg font-extrabold text-fg">
            {g.label} <span className="text-base font-bold tabular-nums text-fg-muted">{g.rows.length}</span>
          </h2>
          <ul className="m-0 list-none divide-y divide-border rounded-2xl border border-border bg-surface-1 p-0 px-4">
            {g.rows.map((r) => (
              <Row key={r.id} r={r} canSwitch={canSwitch} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
