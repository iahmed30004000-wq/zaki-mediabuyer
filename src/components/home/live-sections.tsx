"use client";

import Link from "next/link";
import { AgentChip } from "@/components/ui/agent-chip";
import { JobNumber } from "@/components/ui/job-number";
import { LightStrip } from "@/components/ui/light-strip";
import { SectionTitle } from "@/components/ui/section-title";
import { StateWord } from "@/components/ui/state-word";
import { useLive } from "@/components/tasks/live";
import { agentLamp, agentLine } from "@/core/agent-state";

/**
 * «شغّالة هلق» (docs/rebuild-v6/02-screens.md §2, section 2): a card for every run that is going right now — its number and name, its light strip (a lamp for every step, as the run stored them)
 * and the sentence under it. It follows the live answer by itself (every 5 seconds while a run is going), so the home never has to be reloaded. With nothing going it draws nothing.
 */
export function RunningNow() {
  const { data } = useLive();
  const going = (data?.runs ?? []).filter((r) => r.status === "running");
  if (!going.length) return null;
  return (
    <section className="space-y-3" data-tour="running" aria-label="شغّالة هلق">
      <SectionTitle href="/tasks" linkLabel="كل المهام">
        شغّالة هلق
      </SectionTitle>
      <div className="space-y-3">
        {going.map((r) => (
          <Link key={r.id} href={`/tasks/${encodeURIComponent(r.jobKey)}/runs/${encodeURIComponent(r.id)}`} className="block space-y-3 rounded-2xl border border-border bg-surface-1 p-4 hover:bg-surface-2" data-state="run">
            <span className="flex items-center gap-3">
              <JobNumber n={r.jobNumber} />
              <b className="min-w-0 flex-1 text-base font-extrabold leading-6 text-fg">{r.jobName}</b>
              <StateWord state="run" />
            </span>
            {r.steps.length ? <LightStrip steps={r.steps.map((s) => ({ id: s.id, label: s.label, lamp: s.lamp, ...(s.inferred ? { inferred: true } : {}) }))} label={r.sentence} /> : null}
            <span className="block text-base text-fg">{r.sentence}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/**
 * «مين شغّال» (section 3): a small card for every agent — a lamp and a line («جولة الفريق — 3 من 4» · «ساكت من ساعتين»). The state is what the site saw (the agent's last call), never a guess about
 * what it does. Two columns on a phone's width; with no agent known it draws nothing.
 */
export function WhoWorks() {
  const { data } = useLive();
  if (!data || data.agents.length === 0) return null;
  const now = Date.parse(data.at);
  return (
    <section className="space-y-3" data-tour="agents" aria-label="مين شغّال">
      <SectionTitle hint="بيتحدّث لحاله">مين شغّال</SectionTitle>
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
        {data.agents.map((a) => (
          <li key={a.key}>
            <AgentChip name={a.name} state={agentLamp(a.state)} doing={agentLine(a, now)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
