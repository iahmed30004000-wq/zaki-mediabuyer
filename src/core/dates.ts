/**
 * THE BUSINESS DAY (v3 · the shared date switcher, v4.1 «الأرقام»). A day is a date on the Asia/Amman clock — «2026-11-14» —
 * kept as a plain string, so no time zone can move it: what Claude pushes for a day is that day, and what the screens ask for
 * is that day. «اليوم / امبارح / 7 أيام / مخصص», and the two windows a number is compared with. Pure.
 */
export const TZ = "Asia/Amman";

/** The Amman calendar date of an instant. (UTC+3 all year since 2022; the zone database knows the rest.) */
export function ammanKey(d: Date): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const MS = 86_400_000;
/** UTC midnight of a date key — only for arithmetic and for @db.Date columns, never for «what day is it». */
export const keyMs = (key: string) => Date.parse(`${key}T00:00:00Z`);
/** A real date written YYYY-MM-DD («2026-13-40» looks like one and is not: it must not throw — it may be a query string somebody typed). */
export const isKey = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(keyMs(s)) && new Date(keyMs(s)).toISOString().slice(0, 10) === s;

export function addDays(key: string, n: number): string {
  return new Date(keyMs(key) + n * MS).toISOString().slice(0, 10);
}

/** b − a, in days. */
export const daysBetween = (a: string, b: string) => Math.round((keyMs(b) - keyMs(a)) / MS);

/** Every date from `from` to `to`, both included (empty when `to` is before `from`). */
export function eachDay(from: string, to: string): string[] {
  const n = daysBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addDays(from, i));
}

export type RangeKey = "today" | "yesterday" | "7d" | "custom";
export const RANGE_AR: Record<RangeKey, string> = { today: "اليوم", yesterday: "امبارح", "7d": "7 أيام", custom: "مخصص" };
export const MAX_CUSTOM_DAYS = 92;

export interface Range {
  key: RangeKey;
  from: string;
  to: string;
  days: number;
}

/** `?d=today|yesterday|7d|custom&from=…&to=…` → a range. Anything unreadable is today; a custom range is put in order and capped. */
export function parseRange(q: { d?: string | null; from?: string | null; to?: string | null }, now: Date): Range {
  const today = ammanKey(now);
  const mk = (key: RangeKey, from: string, to: string): Range => ({ key, from, to, days: daysBetween(from, to) + 1 });
  if (q.d === "yesterday") return mk("yesterday", addDays(today, -1), addDays(today, -1));
  if (q.d === "7d") return mk("7d", addDays(today, -6), today);
  if (q.d === "custom" && isKey(q.from) && isKey(q.to)) {
    let [from, to] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
    if (daysBetween(from, to) + 1 > MAX_CUSTOM_DAYS) from = addDays(to, -(MAX_CUSTOM_DAYS - 1));
    return mk("custom", from, to);
  }
  return mk("today", today, today);
}

/** The window of the same length right before this one (for a single day: the day before). */
export function previousRange(r: Range): { from: string; to: string } {
  return { from: addDays(r.from, -r.days), to: addDays(r.from, -1) };
}

/** The seven days right before this window — the «7-day average» a number is compared with (the caller scales it to the window's length). */
export function baselineWindow(r: Range): { from: string; to: string; days: 7 } {
  return { from: addDays(r.from, -7), to: addDays(r.from, -1), days: 7 };
}

export function rangeLabel(r: Range): string {
  return r.key === "custom" ? `${r.from} ← ${r.to}` : r.days === 1 ? `${RANGE_AR[r.key]} (${r.from})` : `${RANGE_AR[r.key]} (${r.from} ← ${r.to})`;
}

/** Amman's offset from UTC at an instant, in minutes (read from the zone database, so a change of the rule does not need a change here). */
function ammanOffsetMin(at: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) === 24 ? 0 : Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - Math.floor(at / 1000) * 1000) / 60_000);
}

/** The instant of a wall-clock time on the Amman clock: «2026-11-23» + «09:30». Null when either part is not a real date or time. */
export function ammanInstant(day: string, hhmm: string): Date | null {
  const t = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!isKey(day) || !t) return null;
  const wall = keyMs(day) + (Number(t[1]) * 60 + Number(t[2])) * 60_000;
  return new Date(wall - ammanOffsetMin(wall) * 60_000);
}

/** The hour and the minute an instant has on the Amman clock. */
export function ammanClock(at: Date): { hour: number; minute: number } {
  const wall = new Date(at.getTime() + ammanOffsetMin(at.getTime()) * 60_000);
  return { hour: wall.getUTCHours(), minute: wall.getUTCMinutes() };
}
