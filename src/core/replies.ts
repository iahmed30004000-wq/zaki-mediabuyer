/**
 * REPLIES CAPACITY (spec 9.3, 9.8, T2.4) — pure. The replies system says how many messages wait without an answer and
 * how fast the first answer comes. A message campaign sends people INTO that inbox, so while the inbox cannot keep up
 * (or we cannot see it) the ladder does not raise message campaigns. Website campaigns are never touched by this.
 * Nothing here reads customer text: only counts and minutes.
 */
export interface CapacityReading {
  unanswered: number;
  firstResponseP50Min: number | null;
  byChannel: Record<string, number>;
  /** when the replies system measured it */
  at: Date;
}

export interface CapacityLimits {
  /** unanswered messages above this = the inbox is behind */
  maxUnanswered: number;
  /** median minutes to the first answer above this = too slow */
  maxP50Min: number;
  /** a reading (or a sync) older than this = we can not see the inbox */
  staleHours: number;
}

export const CAPACITY_DEFAULTS: CapacityLimits = { maxUnanswered: 50, maxP50Min: 30, staleHours: 2 };

export interface CapacityVerdict {
  /** true = message campaigns may be scaled */
  ok: boolean;
  /** stale · behind · slow · down · null when ok */
  cause: "down" | "stale" | "behind" | "slow" | null;
  /** Arabic sentence for the freeze reason and the alert; null when ok */
  sentence: string | null;
}

/**
 * `reading` is null when the replies system did not answer. `ageHours` is the age of the last successful sync (null =
 * never). Worst case first: spec 9.8 «نظام الردود واقف ← افتراض الأسوأ: تجميد تكبير حملات الرسائل».
 */
export function judgeCapacity(reading: CapacityReading | null, ageHours: number | null, limits: CapacityLimits = CAPACITY_DEFAULTS, now = new Date()): CapacityVerdict {
  if (!reading) return { ok: false, cause: "down", sentence: "نظام الردود ما بيرد — تكبير حملات الرسائل مجمّد لحد ما يرجع" };
  const measuredHours = (now.getTime() - reading.at.getTime()) / 3_600_000;
  const old = Math.max(ageHours ?? Infinity, measuredHours);
  if (old > limits.staleHours) return { ok: false, cause: "stale", sentence: `قياس نظام الردود قديم (${Math.round(old)} ساعات) — تكبير حملات الرسائل مجمّد` };
  if (reading.unanswered > limits.maxUnanswered) return { ok: false, cause: "behind", sentence: `${reading.unanswered} رسالة بلا رد (الحد ${limits.maxUnanswered}) — ما منكبّر حملات الرسائل لحد ما الفريق يلحق` };
  if (reading.firstResponseP50Min !== null && reading.firstResponseP50Min > limits.maxP50Min) return { ok: false, cause: "slow", sentence: `أول رد بياخد ${reading.firstResponseP50Min} دقيقة (الحد ${limits.maxP50Min}) — تكبير حملات الرسائل مجمّد` };
  return { ok: true, cause: null, sentence: null };
}

/** The marker every freeze made by this rule carries, so it can be found and lifted without touching other freezes. */
export const REPLIES_FREEZE_MARK = "replies:";
