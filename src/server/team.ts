/**
 * THE TEAM (spec 13.8 / S17) — the owner invites a member by e-mail and role. The system makes a one-time code,
 * shows it to the owner ONCE and keeps only its sha256; the member signs in with the code and chooses their own
 * password. Nobody else ever sees or types a member's password. A code lives 72 hours.
 */
import { createHash, randomBytes } from "node:crypto";
import type { RoleKey } from "@/core/roles";

export const INVITE_HOURS = 72;

export function newInviteCode(): string {
  // 4 groups of 4 characters, easy to read out over the phone: no 0/O or 1/l
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(16);
  const chars = [...bytes].map((b) => abc[b % abc.length]);
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

export const hashInvite = (code: string) => createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");

/** May `actor` give `target` this role / switch them off? The owner never locks the system out of its last owner. */
export function teamChange(o: { actorId: string; targetId: string; targetRole: RoleKey; owners: number; to?: { role?: RoleKey; active?: boolean } }): { ok: boolean; why: string } {
  const losesOwner = o.targetRole === "OWNER" && ((o.to?.role && o.to.role !== "OWNER") || o.to?.active === false);
  if (losesOwner && o.owners <= 1) return { ok: false, why: "هاد آخر مالك — لازم يضل مالك واحد على الأقل" };
  if (o.actorId === o.targetId && (o.to?.active === false || (o.to?.role && o.to.role !== o.targetRole))) return { ok: false, why: "ما بتقدر تغيّر دورك أو توقف حسابك بإيدك" };
  return { ok: true, why: "تمام" };
}
