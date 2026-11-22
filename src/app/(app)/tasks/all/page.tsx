import Link from "next/link";
import { AllList } from "@/components/tasks/all-list";
import { AllMenu } from "@/components/tasks/all-menu";
import { DecideAll } from "@/components/tasks/decide-all";
import { TidyPanel, type TidyPair } from "@/components/tasks/tidy-panel";
import { Chip } from "@/components/ui/chip";
import type { DuplicateReason } from "@/core/job-map";
import { ALL_KINDS, ALL_KIND_AR, type AllKind } from "@/core/tasks-view";
import { can } from "@/core/roles";
import { loadJobs } from "@/lib/jobs-view";
import { loadAll } from "@/lib/tasks-view";
import { cn } from "@/lib/utils";
import { currentCaller, requirePage } from "@/server/auth";
import { taskKeysFor } from "@/server/directory";
import { listDuplicates, listNeverRun } from "@/server/job-map";
import { isDemo } from "@/core/readiness";

export const metadata = { title: "كل المهام" };
export const dynamic = "force-dynamic";

const WHY: Record<DuplicateReason, string> = { name: "نفس الاسم", schedule: "نفس الموعد ونفس المنفّذ", linked: "مرتبطتين" };

/**
 * المهام ← كل المهام: ONE list of the jobs and the people's tasks (kind «لشخص»), in two groups; filters for the kind and the person. «⋯»: «قرّر عليهم مرة وحدة» (the decision sheet),
 * «نسخة للطباعة», and «نظّف المكرّر» when the site found a job written twice — the screen where the owner tidies the map once (`?tidy=1`).
 */
export default async function TasksAllPage({ searchParams: searchParamsP }: { searchParams: Promise<{ kind?: string; who?: string; decide?: string; tidy?: string }> }) {
  await requirePage("work.view");
  const sp = await searchParamsP;
  const me = await currentCaller();
  const owner = !!me && !me.demo && can(me.role, "work.control");
  const kind = (ALL_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as AllKind) : null;
  const who = /^[a-z][a-z0-9_-]{1,31}$/.test(sp.who ?? "") ? (sp.who as string) : null;
  const keys = me ? await taskKeysFor(me) : [];
  const live = !isDemo(process.env);
  const [pairs, neverRun] = owner && live ? await Promise.all([listDuplicates(), listNeverRun()]) : [[], []];
  const view = await loadAll({ kind, who, taskKeys: keys, duplicates: pairs.length });
  const href = (next: { kind?: AllKind | null; who?: string | null }) => {
    const k = next.kind === undefined ? kind : next.kind;
    const w = next.who === undefined ? who : next.who;
    const q = [k ? `kind=${k}` : "", w ? `who=${w}` : ""].filter(Boolean).join("&");
    return `/tasks/all${q ? `?${q}` : ""}`;
  };
  const chip = (on: boolean) => cn("h-10 max-md:h-11 px-3 text-sm", on && "border-accent bg-accent text-accent-fg");

  let tidy: TidyPair[] = [];
  if (sp.tidy && owner) {
    const { jobs } = await loadJobs();
    const by = new Map(jobs.map((j) => [j.key, { key: j.key, name: j.name, number: j.number }]));
    tidy = pairs.flatMap((p) => {
      const keep = by.get(p.keep);
      const drop = by.get(p.drop);
      return keep && drop ? [{ keep, drop, why: p.reasons.map((r) => WHY[r]).join(" · ") }] : [];
    });
  }
  const sheet = sp.decide && owner ? (await loadJobs()).jobs : null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2" role="group" aria-label="فلتر">
          <Link href={href({ kind: null })} aria-current={!kind ? "true" : undefined}>
            <Chip className={chip(!kind)}>الكل</Chip>
          </Link>
          {ALL_KINDS.map((k) => (
            <Link key={k} href={href({ kind: k === kind ? null : k })} aria-current={k === kind ? "true" : undefined}>
              <Chip className={chip(k === kind)}>{ALL_KIND_AR[k]}</Chip>
            </Link>
          ))}
        </div>
        <AllMenu canDecide={owner} duplicates={pairs.length} />
      </div>
      {view.who.length ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="مين">
          {view.who.map((w) => (
            <Link key={w.key} href={href({ who: w.key === who ? null : w.key })} aria-current={w.key === who ? "true" : undefined}>
              <Chip className={chip(w.key === who)}>{w.label}</Chip>
            </Link>
          ))}
        </div>
      ) : null}
      {sheet ? <DecideAll jobs={sheet} /> : null}
      {sp.tidy && owner ? <TidyPanel pairs={tidy} neverRun={neverRun} /> : null}
      <AllList groups={view.groups} canSwitch={owner} />
    </div>
  );
}
