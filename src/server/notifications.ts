/**
 * THE BELL, the server side (v6 · P3, docs/rebuild-v6/02-screens.md §7): the notices of the person who is signed in, and «علّم الكل مقروء». A notice is written for an
 * audience — `owner` (the owner and the manager) or a person's key; a role that is not either sees an empty bell, never somebody else's notices. `readAt` is really written (W-07).
 */
import { BELL_LIMIT, bellItems, type BellItem } from "@/core/bell";
import { db } from "./db";
import { actorOfUser } from "./directory";
import type { Caller } from "./auth";

/** The audience of a caller: the owner's notices for the owner and the manager; for anybody else the key of the person their account is linked to, or none. */
export async function audienceOf(caller: Pick<Caller, "id" | "role" | "demo">): Promise<string | null> {
  if (caller.demo || caller.role === "OWNER" || caller.role === "MANAGER") return "owner";
  const me = await actorOfUser(caller.id);
  return me?.key ?? null;
}

export interface BellData {
  unread: number;
  items: BellItem[];
}

export async function loadBell(caller: Pick<Caller, "id" | "role" | "demo">, now = new Date()): Promise<BellData> {
  const audience = await audienceOf(caller);
  if (!audience) return { unread: 0, items: [] };
  const [rows, unread] = await Promise.all([
    db.notification.findMany({ where: { audience }, orderBy: { createdAt: "desc" }, take: BELL_LIMIT }),
    db.notification.count({ where: { audience, readAt: null } }),
  ]);
  return { unread, items: bellItems(rows, now) };
}

/** Marks the person's notices read — all of them, or only these ids (always inside their own audience). Returns how many changed. */
export async function markBellRead(caller: Pick<Caller, "id" | "role" | "demo">, ids?: readonly string[], now = new Date()): Promise<number> {
  const audience = await audienceOf(caller);
  if (!audience) return 0;
  const r = await db.notification.updateMany({ where: { audience, readAt: null, ...(ids?.length ? { id: { in: [...ids] } } : {}) }, data: { readAt: now } });
  return r.count;
}
