/**
 * WHEN AN AGENT WAS LAST HEARD FROM (docs/rebuild-v6/01-model.md §11). Every tool call under a token that is tied to an agent of the team directory
 * refreshes `Actor.lastSeenAt` — at most once a minute per agent, so a busy session does not hammer the table. The site reads it to tell «awake»
 * from «silent» (src/core/agent-seen.ts).
 */
import { SEEN_EVERY_MS, shouldTouch } from "@/core/agent-seen";
import { db } from "./db";

const lastTouch = new Map<string, number>();

export async function touchAgent(actorKey: string | null | undefined, now = new Date()): Promise<void> {
  if (!actorKey || !shouldTouch(lastTouch.get(actorKey) ?? null, now.getTime())) return;
  lastTouch.set(actorKey, now.getTime());
  try {
    // the condition is in the statement too: a second instance (or a restart) still writes at most once a minute
    await db.actor.updateMany({ where: { key: actorKey, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - SEEN_EVERY_MS) } }] }, data: { lastSeenAt: now } });
  } catch (e) {
    // a failure to note that an agent was seen must never fail its call
    console.error("agent lastSeenAt failed:", e instanceof Error ? e.message : e);
  }
}
