/**
 * A small cron for «next run» and «tomorrow's runs» (v3 · F, G): five fields — minute hour day-of-month month
 * day-of-week (0 = Sunday) — read on the Amman clock. A star, lists (1,5), ranges (10-22) and steps (a star with a
 * step, or 11-21 with a step of 2). Pure. Day-of-month and day-of-week follow cron's own rule: when both are
 * restricted, either one matches.
 */
const TZ = "Asia/Amman";

interface Parsed {
  minute: number[];
  hour: number[];
  dom: number[] | null;
  month: number[];
  dow: number[] | null;
}

function field(src: string, min: number, max: number, name: string): number[] | null {
  if (src === "*") return null;
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new Error(`cron: ${name} «${part}» مش مفهوم`);
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) throw new Error(`cron: خطوة ${name} لازم ≥ 1`);
    let a: number;
    let b: number;
    if (m[1] === "*") {
      a = min;
      b = max;
    } else if (m[1]!.includes("-")) {
      const [x, y] = m[1]!.split("-").map(Number);
      a = x!;
      b = y!;
    } else {
      a = Number(m[1]);
      b = m[2] ? max : a; // «5/15»: from 5, every 15, to the end
    }
    if (a < min || b > max || a > b) throw new Error(`cron: ${name} خارج المجال ${min}–${max}`);
    for (let v = a; v <= b; v += step) out.add(v);
  }
  return [...out].sort((x, y) => x - y);
}

export function parseCron(expr: string): Parsed {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) throw new Error("cron: لازم 5 خانات (دقيقة ساعة يوم-بالشهر شهر يوم-بالأسبوع)");
  const dow = field(f[4]!, 0, 7, "اليوم بالأسبوع");
  return {
    minute: field(f[0]!, 0, 59, "الدقيقة") ?? Array.from({ length: 60 }, (_, i) => i),
    hour: field(f[1]!, 0, 23, "الساعة") ?? Array.from({ length: 24 }, (_, i) => i),
    dom: field(f[2]!, 1, 31, "اليوم بالشهر"),
    month: field(f[3]!, 1, 12, "الشهر") ?? Array.from({ length: 12 }, (_, i) => i + 1),
    dow: dow ? [...new Set(dow.map((d) => d % 7))].sort((x, y) => x - y) : null,
  };
}

export function isValidCron(expr: string): boolean {
  try {
    parseCron(expr);
    return true;
  } catch {
    return false;
  }
}

/** Amman's offset from UTC at an instant, in minutes. */
function offsetMinutes(at: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) === 24 ? 0 : Number(p.hour), Number(p.minute), Number(p.second));
  return Math.round((local - Math.floor(at / 1000) * 1000) / 60_000);
}

/** The Amman calendar day of an instant: its UTC midnight (so `getUTCDay()` etc. read the Amman weekday). */
function ammanDay(at: number): number {
  const off = offsetMinutes(at) * 60_000;
  const d = new Date(at + off);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** The next `count` runs strictly after `from`, looking at most `horizonDays` ahead. */
export function nextRuns(expr: string, from: Date, count = 1, horizonDays = 14): Date[] {
  const c = parseCron(expr);
  const out: Date[] = [];
  const start = from.getTime();
  const day0 = ammanDay(start);
  for (let i = 0; i <= horizonDays && out.length < count; i++) {
    const day = new Date(day0 + i * 86_400_000);
    const dom = day.getUTCDate();
    const month = day.getUTCMonth() + 1;
    const dow = day.getUTCDay();
    if (!c.month.includes(month)) continue;
    const domOk = c.dom ? c.dom.includes(dom) : true;
    const dowOk = c.dow ? c.dow.includes(dow) : true;
    const dayOk = c.dom && c.dow ? domOk || dowOk : domOk && dowOk;
    if (!dayOk) continue;
    for (const h of c.hour) {
      for (const m of c.minute) {
        const wall = Date.UTC(day.getUTCFullYear(), month - 1, dom, h, m);
        const utc = wall - offsetMinutes(wall) * 60_000;
        if (utc > start && out.length < count) out.push(new Date(utc));
      }
    }
  }
  return out.sort((a, b) => a.getTime() - b.getTime()).slice(0, count);
}

/** Every run inside [from, to). */
export function runsBetween(expr: string, from: Date, to: Date): Date[] {
  const days = Math.ceil((to.getTime() - from.getTime()) / 86_400_000) + 1;
  return nextRuns(expr, new Date(from.getTime() - 1), 500, days).filter((d) => d < to);
}
