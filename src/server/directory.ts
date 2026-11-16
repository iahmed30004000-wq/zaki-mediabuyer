/**
 * THE TEAM DIRECTORY, read and written (docs/rebuild/05-permissions.md §4). `Actor` rows are people and agents; the demo and an empty table fall back to the
 * seven the code has always known (`fallbackDirectory`). The Telegram number never leaves the server: a row says only that one is set.
 */
import { isDemo } from "@/core/readiness";
import { displayName, fallbackDirectory, type DirEntry } from "@/core/directory";
import { taskScopeOf } from "@/core/roles";
import type { Caller } from "./auth";
import { db } from "./db";
import { getSetting } from "./settings";

const entry = (r: { key: string; name: string; kind: string; team: string | null; userId: string | null; telegram: string | null; active: boolean }): DirEntry => ({
  key: r.key,
  name: displayName(r),
  kind: r.kind === "agent" ? "agent" : "person",
  team: r.team,
  userId: r.userId,
  hasTelegram: !!r.telegram,
  active: r.active,
});

export async function loadDirectory(opts: { includeInactive?: boolean } = {}): Promise<DirEntry[]> {
  if (isDemo(process.env)) return fallbackDirectory();
  const rows = await db.actor.findMany({ where: opts.includeInactive ? {} : { active: true }, orderBy: [{ kind: "asc" }, { key: "asc" }] });
  return rows.length ? rows.map(entry) : fallbackDirectory();
}

/** key → the name to show, for the screens that print a person. */
export async function directoryNames(): Promise<Record<string, string>> {
  return Object.fromEntries((await loadDirectory({ includeInactive: true })).map((e) => [e.key, e.name]));
}

/** The keys a push of «person» rows may carry (`push_metrics` level person). */
export async function directoryKeys(): Promise<string[]> {
  return (await loadDirectory()).map((e) => e.key);
}

/** The directory entry of a signed-in person, if the owner linked their account to one. */
export async function actorOfUser(userId: string): Promise<DirEntry | null> {
  if (isDemo(process.env)) return null;
  const r = await db.actor.findUnique({ where: { userId } });
  return r ? entry(r) : null;
}

/**
 * Whose tasks this caller may see: `null` = everybody's; otherwise the assignee keys (their own, or their whole team's for a team lead). A person whose account
 * is not linked to the directory sees no task of anybody's — never «all» by default (§3 «المجال»).
 */
export async function taskKeysFor(caller: Caller): Promise<string[] | null> {
  const scope = taskScopeOf(caller.role);
  if (scope === "all" || caller.demo) return null;
  const me = await actorOfUser(caller.id);
  if (!me) return [];
  if (scope === "own" || !me.team) return [me.key];
  const team = (await loadDirectory()).filter((e) => e.team === me.team).map((e) => e.key);
  return team.includes(me.key) ? team : [...team, me.key];
}

/**
 * The Telegram chat an actor's notifications go to: the directory's (set from the team screen), then — for a chat the owner put there before the directory existed —
 * the old `notify.contacts` setting. The number itself never goes to a screen or a model; this is only for the sender.
 */
export async function telegramOf(key: string): Promise<string | null> {
  const r = await db.actor.findUnique({ where: { key }, select: { telegram: true, active: true } });
  if (r?.telegram && r.active) return r.telegram;
  const old = (await getSetting("notify.contacts"))[key];
  return old || null;
}
