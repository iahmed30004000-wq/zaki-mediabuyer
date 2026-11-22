/**
 * AWAKE / ASLEEP (v4 · D) — the owner's one switch. Pure: time is passed in (Asia/Amman is read from it here).
 *
 *   صاحي   jobs run, approvals ring
 *   نايم   nothing rings (unless he marked that KIND of decision «يصحّيني»); decisions that need him wait in a queue and
 *          come out as one «صباح الخير» card; only the jobs he whitelisted in «صلاحيات الليل» run, each inside its cap
 *
 * The switch can follow a schedule (awake 10:00, asleep 02:00): then the clock decides and the manual value is the fallback.
 */
import { z } from "zod";
import { nextRuns } from "./cron";

const hm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "الوقت بصيغة HH:MM");

export const OwnerModeSchema = z
  .object({
    mode: z.enum(["awake", "asleep"]),
    since: z.string().nullable(),
    /** when he last went to sleep — kept after he wakes, so the «صباح الخير» card covers the night */
    asleepAt: z.string().nullable().optional(),
    schedule: z.object({ enabled: z.boolean(), awake: hm, asleep: hm }).strict(),
  })
  .strict();
export type OwnerMode = z.infer<typeof OwnerModeSchema>;

export const DEFAULT_MODE: OwnerMode = { mode: "awake", since: null, schedule: { enabled: false, awake: "10:00", asleep: "02:00" } };

/** A job (or a kind of action) the owner allows while he sleeps, with the most it may spend. */
export const NightPermissionSchema = z
  .object({
    key: z.string().trim().min(1).max(60).describe("مفتاح المهمة (مثلاً night-round)"),
    label: z.string().trim().min(1).max(120),
    cap: z.number().nonnegative().max(1_000_000).nullable().optional().describe("أقصى صرف بالدولار لهالمهمة وهو نايم"),
  })
  .strict();
export type NightPermission = z.infer<typeof NightPermissionSchema>;

/** «HH:MM» on the Amman clock. */
export function ammanHM(now: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now).map((x) => [x.type, x.value]));
  return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

/** Is `now` inside the awake window [awake, asleep)? The window may cross midnight (10:00 → 02:00). */
export function inAwakeWindow(now: string, awake: string, asleep: string): boolean {
  if (awake === asleep) return true;
  return awake < asleep ? now >= awake && now < asleep : now >= awake || now < asleep;
}

export function effectiveMode(m: OwnerMode, now: Date): "awake" | "asleep" {
  return m.schedule.enabled ? (inAwakeWindow(ammanHM(now), m.schedule.awake, m.schedule.asleep) ? "awake" : "asleep") : m.mode;
}

export type Urgency = "red" | "orange" | "yellow";
export type Delivery = "ring" | "notify" | "silent" | "queue";

/**
 * What a decision request does to the phone right now.
 *   🔴 rings (full screen, a ringtone, until answered or 60 s) — only awake, or when the owner marked its kind «يصحّيني»
 *   🟠 a normal notification with a sound — only awake
 *   🟡 silent: it shows in اليوم, never on the phone
 * Asleep, anything that would sound waits in the queue for the morning card.
 */
export function deliveryFor(urgency: Urgency, mode: "awake" | "asleep", wakeOwner: boolean): Delivery {
  if (urgency === "yellow") return "silent";
  if (mode === "asleep") return urgency === "red" && wakeOwner ? "ring" : "queue";
  return urgency === "red" ? "ring" : "notify";
}

/** May this job run now? Awake: yes. Asleep: only the whitelisted ones — and only inside their cap. */
export function mayRun(jobKey: string, mode: "awake" | "asleep", night: NightPermission[]): { ok: boolean; cap: number | null; why: string } {
  if (mode === "awake") return { ok: true, cap: null, why: "صاحي" };
  const p = night.find((n) => n.key === jobKey);
  return p ? { ok: true, cap: p.cap ?? null, why: "مسموحة بالليل" } : { ok: false, cap: null, why: "المالك نايم وهالمهمة مش بـ «صلاحيات الليل» — بتستنى لحد ما يصحى" };
}

/**
 * The night that just ended, for the «صباح الخير» card: from when he fell asleep to when he woke. With a schedule the
 * clock knows both; by hand the switch remembered them. Null when there is no night to report (still asleep, or never slept).
 */
export function lastNight(m: OwnerMode, now: Date): { from: Date; to: Date } | null {
  if (effectiveMode(m, now) !== "awake") return null;
  if (m.schedule.enabled) {
    const at = (hm: string, before: Date) => {
      const [h, min] = hm.split(":").map(Number);
      const hits = nextRuns(`${min} ${h} * * *`, new Date(before.getTime() - 2 * 86_400_000), 4).filter((d) => d <= before);
      return hits[hits.length - 1] ?? null;
    };
    const woke = at(m.schedule.awake, now);
    const slept = woke ? at(m.schedule.asleep, woke) : null;
    return woke && slept ? { from: slept, to: woke } : null;
  }
  return m.asleepAt && m.since ? { from: new Date(m.asleepAt), to: new Date(m.since) } : null;
}
