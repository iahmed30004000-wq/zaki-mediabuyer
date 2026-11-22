"use client";

import { AgentChip } from "@/components/ui/agent-chip";
import { agentLine, agentLamp } from "@/core/agent-state";
import { cn } from "@/lib/utils";
import { useLive } from "./live";

/**
 * «مين شغّال»: a small card for every agent — a lamp and a line («شغّال هلق» · «صاحي» · «ساكت من ساعتين»). The state is what the site saw (the agent's last call), never a guess
 * about what it does. It follows the live answer by itself; with no agent known it draws nothing.
 */
export function AgentsStrip({ className, compact = false }: { className?: string; compact?: boolean }) {
  const { data } = useLive();
  if (!data || data.agents.length === 0) return null;
  // the clock of the answer itself (the site's), so the sentence is the same on every render
  const now = Date.parse(data.at);
  return (
    <ul aria-label="مين شغّال" className={cn("m-0 grid list-none gap-2 p-0", compact ? "grid-cols-1" : "sm:grid-cols-2", className)}>
      {data.agents.map((a) => (
        <li key={a.key}>
          <AgentChip name={a.name} state={agentLamp(a.state)} doing={agentLine(a, now)} />
        </li>
      ))}
    </ul>
  );
}
