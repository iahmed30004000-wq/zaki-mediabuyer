/**
 * THE TEAM DIRECTORY (docs/rebuild/05-permissions.md §4): people and agents as DATA. `PEOPLE` in tasks.ts stays in the code only as the fallback for an
 * empty table (tests, a fresh database); every screen and every check reads the table through src/server/directory.ts. A new person's name is written from the
 * team screen, never in the code (the repo is public).
 */
import { PEOPLE } from "./tasks";

export const ACTOR_KINDS = ["person", "agent"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const TEAMS = [
  { key: "management", label: "الإدارة" },
  { key: "ads", label: "الإعلانات" },
  { key: "confirm", label: "التأكيد" },
  { key: "stock", label: "المخزون" },
  { key: "video", label: "الفيديو" },
  { key: "shipping", label: "الشحن" },
] as const;
export type TeamKey = (typeof TEAMS)[number]["key"];
export const teamLabel = (key: string | null | undefined): string => TEAMS.find((t) => t.key === key)?.label ?? "بلا فريق";

export interface DirEntry {
  key: string;
  name: string;
  kind: ActorKind;
  team: string | null;
  /** the account this person signs in with, if any */
  userId: string | null;
  /** a chat is set (the number itself stays on the server) */
  hasTelegram: boolean;
  active: boolean;
}

/** An Actor's key is the one thing that never changes (Task.assignee holds it): lower-case letters, digits, dash, underscore. */
export const ACTOR_KEY = /^[a-z][a-z0-9_-]{1,31}$/;

const AGENT_KEYS: readonly string[] = ["hermes", "muse", "claude"];

/** The directory when the table has nothing (or the demo): the seven who always existed, keyed as before. */
export function fallbackDirectory(): DirEntry[] {
  return PEOPLE.map((p) => ({ key: p.key, name: p.label, kind: AGENT_KEYS.includes(p.key) ? "agent" : "person", team: null, userId: null, hasTelegram: false, active: true }));
}

/** The name to show: what the owner wrote, or — while the row still carries only its key — the label the code has always shown. */
export function displayName(row: { key: string; name: string }): string {
  if (row.name && row.name !== row.key) return row.name;
  return PEOPLE.find((p) => p.key === row.key)?.label ?? row.name ?? row.key;
}

export type ActorCheck = { ok: true; value: { key: string; name: string; kind: ActorKind; team: string | null } } | { ok: false; error: string };

/** What the team screen may save for a new or edited entry. */
export function checkActor(i: { key?: unknown; name?: unknown; kind?: unknown; team?: unknown }, opts: { creating: boolean }): ActorCheck {
  const key = typeof i.key === "string" ? i.key.trim().toLowerCase() : "";
  if (opts.creating && !ACTOR_KEY.test(key)) return { ok: false, error: "المفتاح حروف إنجليزية صغيرة وأرقام (مثلاً: sara)" };
  const name = typeof i.name === "string" ? i.name.trim() : "";
  if (!name || name.length > 60) return { ok: false, error: "اكتب الاسم (لحد ٦٠ حرف)" };
  if (/\S+@\S+/.test(name) || /\d{6,}/.test(name)) return { ok: false, error: "الاسم بس — بلا رقم أو إيميل" };
  if (!ACTOR_KINDS.includes(i.kind as ActorKind)) return { ok: false, error: "اختار شخص أو وكيل" };
  const team = i.team === null || i.team === undefined || i.team === "" ? null : String(i.team);
  if (team !== null && !TEAMS.some((t) => t.key === team)) return { ok: false, error: "فريق مش معروف" };
  return { ok: true, value: { key, name, kind: i.kind as ActorKind, team } };
}
