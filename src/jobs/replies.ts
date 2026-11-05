/**
 * replies.sync (spec 9.3, 9.8, T2.4) — every 15 minutes: read the replies system's capacity and keep ONE freeze on the
 * scale ladder for every active message ad set while the inbox cannot keep up (or cannot be seen). The freeze is lifted
 * the moment the verdict is good again. Website campaigns are never frozen by this. A freeze only stops raising; it
 * never pauses or lowers anything. The reading itself is the job's stats — no table, no customer data.
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { readCapacity, type RepliesOptions } from "@/adapters/replies";
import { judgeCapacity, REPLIES_FREEZE_MARK, type CapacityReading, type CapacityVerdict } from "@/core/replies";

export interface RepliesStats extends Record<string, unknown> {
  ok: boolean;
  cause: CapacityVerdict["cause"];
  sentence: string | null;
  unanswered: number | null;
  firstResponseP50Min: number | null;
  measuredAt: string | null;
  frozenAdSets: number;
  lifted: number;
  error?: string;
}

export async function syncReplies(o: RepliesOptions | null, now = new Date()): Promise<RepliesStats | { skipped: string }> {
  if (!o) return { skipped: "Replies system not linked yet (T2.4)" };
  let reading: CapacityReading | null = null;
  let error: string | undefined;
  try {
    reading = await readCapacity(o);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const limits = await getSetting("replies.limits");
  const verdict = judgeCapacity(reading, reading ? 0 : null, limits, now);

  const freezes = await db.freeze.findMany({ where: { kind: "scale", liftedAt: null, reason: { startsWith: REPLIES_FREEZE_MARK } } });
  let frozenAdSets = 0;
  let lifted = 0;
  if (verdict.ok) {
    if (freezes.length) {
      await db.freeze.updateMany({ where: { id: { in: freezes.map((f) => f.id) } }, data: { liftedAt: now } });
      lifted = freezes.length;
    }
  } else {
    const msg = await db.adSet.findMany({ where: { status: { notIn: ["PAUSED", "ARCHIVED", "DELETED"] }, campaign: { parsedObjective: "MSG", status: { notIn: ["PAUSED", "ARCHIVED", "DELETED"] } } }, select: { metaId: true } });
    const has = new Set(freezes.map((f) => f.targetId));
    for (const s of msg) {
      if (has.has(s.metaId)) continue;
      await db.freeze.create({ data: { scope: "adset", targetId: s.metaId, kind: "scale", reason: `${REPLIES_FREEZE_MARK} ${verdict.sentence}`, until: null } });
    }
    frozenAdSets = msg.length;
    // a message ad set that is no longer active has nothing to hold back
    const live = new Set(msg.map((s) => s.metaId));
    const gone = freezes.filter((f) => !live.has(f.targetId));
    if (gone.length) {
      await db.freeze.updateMany({ where: { id: { in: gone.map((f) => f.id) } }, data: { liftedAt: now } });
      lifted = gone.length;
    }
  }
  return { ok: verdict.ok, cause: verdict.cause, sentence: verdict.sentence, unanswered: reading?.unanswered ?? null, firstResponseP50Min: reading?.firstResponseP50Min ?? null, measuredAt: reading?.at.toISOString() ?? null, frozenAdSets, lifted, ...(error ? { error } : {}) };
}
