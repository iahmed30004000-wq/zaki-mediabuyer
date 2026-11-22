/**
 * AN AGENT, IN ONE LINE (v6 · P3, docs/rebuild-v6/02-screens.md §2 «مين شغّال»): the lamp and the sentence for what the site saw of him — a run going, a call in the last minutes,
 * or silence. It says only what was seen: «ساكت من ساعتين» is the time since his last call, not a guess about why.
 */
import { agoWords } from "./bell";
import type { Lamp } from "./run-state";

export type AgentLiveState = "running" | "awake" | "silent";

/** run = going now · done = awake and ready · off = silent. */
export const agentLamp = (s: AgentLiveState): Lamp => (s === "running" ? "run" : s === "awake" ? "done" : "off");

/** «شغّال هلق» · «صاحي — عنده 2 بالانتظار» · «ساكت من ساعتين» · «ما ظهر لسا». `now` is a millisecond clock. */
export function agentLine(a: { state: AgentLiveState; lastSeenAt: string | null; queued: number }, now: number): string {
  const waiting = a.queued > 0 ? ` — عنده ${a.queued} بالانتظار` : "";
  if (a.state === "running") return `شغّال هلق${waiting}`;
  if (a.state === "awake") return `صاحي${waiting}`;
  if (!a.lastSeenAt) return `ما ظهر لسا${waiting}`;
  const since = agoWords((now - Date.parse(a.lastSeenAt)) / 60_000).replace(/^قبل\s*/, "");
  return `ساكت من ${since}${waiting}`;
}
