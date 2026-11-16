/**
 * THE OPERATIONS SCREENS' DATA (docs/rebuild/06-dashboards.md §4): the numbers of the confirmation team (`PersonDay`), a job's own metric day by day
 * (`metricSeries`), and the owner's limits for the flags (`ops.rules`). Read only; nothing here writes an order or a shipment.
 */
import { ammanKey, addDays } from "@/core/dates";
import { isDemo } from "@/core/readiness";
import { median, noAnswerRate, personFlag, readOpsRules, type OpsRules, type PersonFlag } from "@/core/ops";
import { db } from "./db";
import { directoryNames } from "./directory";
import { getSetting } from "./settings";

export interface SeriesPoint {
  day: string;
  value: number | null;
}

/** A job's metric for each of the last `days` Amman days: the value of the LAST run of that day that carried it, else null (no guess). Oldest first. */
export async function metricSeries(jobKey: string, key: string, days: number, now = new Date()): Promise<SeriesPoint[]> {
  const today = ammanKey(now);
  const first = addDays(today, -(days - 1));
  const out: SeriesPoint[] = Array.from({ length: days }, (_, i) => ({ day: addDays(first, i), value: null }));
  if (isDemo(process.env)) return out;
  const since = new Date(`${first}T00:00:00Z`);
  since.setUTCHours(since.getUTCHours() - 3);
  const runs = await db.workflowRun.findMany({ where: { workflow: { key: jobKey }, startedAt: { gte: since } }, orderBy: { startedAt: "asc" }, select: { startedAt: true, metrics: true } });
  for (const r of runs) {
    const m = r.metrics as Record<string, unknown> | null;
    const v = m ? m[key] : undefined;
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const p = out.find((x) => x.day === ammanKey(r.startedAt));
    if (p) p.value = v;
  }
  return out;
}

/** The newest value of one metric of one job (any day), with when it was said. */
export async function latestMetric(jobKey: string, key: string): Promise<{ value: number; at: string } | null> {
  if (isDemo(process.env)) return null;
  const runs = await db.workflowRun.findMany({ where: { workflow: { key: jobKey } }, orderBy: { startedAt: "desc" }, take: 20, select: { startedAt: true, metrics: true } });
  for (const r of runs) {
    const v = (r.metrics as Record<string, unknown> | null)?.[key];
    if (typeof v === "number" && Number.isFinite(v)) return { value: v, at: r.startedAt.toISOString() };
  }
  return null;
}

export async function loadOpsRules(): Promise<OpsRules> {
  return readOpsRules(await getSetting("ops.rules"));
}

export interface TeamRow {
  key: string;
  name: string;
  claims: number | null;
  confirmed: number | null;
  rejected: number | null;
  noAnswer: number | null;
  noAnswerRate: number | null;
  firstClaimSec: number | null;
  stuck48h: number | null;
  reactivated: number | null;
  daysOfData: number;
  flag: PersonFlag | null;
}

export interface TeamData {
  days: number;
  rows: TeamRow[];
  /** the rejection reasons summed over the window, most frequent first */
  reasons: { reason: string; count: number }[];
  /** the team's totals (for someone who may not see names) */
  total: { claims: number | null; confirmed: number | null; rejected: number | null; noAnswer: number | null; stuck48h: number | null };
  medianNoAnswer: number | null;
}

const sum = (xs: (number | null)[]): number | null => (xs.every((x) => x === null) ? null : xs.reduce<number>((s, x) => s + (x ?? 0), 0));

/**
 * The confirmation team over the last `days` days: a row per person (summed), the flag by the owner's limits, the reasons for rejection. Without
 * `people` (the caller lacks `ops.people`) no row is returned — the team's totals only, decided HERE on the server, never hidden by the screen.
 */
export async function loadTeam(days = 7, now = new Date(), opts: { people?: boolean } = {}): Promise<TeamData> {
  const people = opts.people !== false;
  const empty: TeamData = { days, rows: [], reasons: [], total: { claims: null, confirmed: null, rejected: null, noAnswer: null, stuck48h: null }, medianNoAnswer: null };
  if (isDemo(process.env)) return empty;
  const from = new Date(`${addDays(ammanKey(now), -(days - 1))}T00:00:00Z`);
  const [rows, rules, names] = await Promise.all([db.personDay.findMany({ where: { date: { gte: from } }, orderBy: { date: "asc" } }), loadOpsRules(), directoryNames()]);
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.actorKey, [...(by.get(r.actorKey) ?? []), r]);
  const reasonSum = new Map<string, number>();
  const team: Omit<TeamRow, "flag">[] = [...by.entries()].map(([key, list]) => {
    for (const r of list) for (const x of (Array.isArray(r.rejectReasons) ? r.rejectReasons : []) as { reason?: string; count?: number }[]) if (x?.reason) reasonSum.set(x.reason, (reasonSum.get(x.reason) ?? 0) + (Number(x.count) || 0));
    const claims = sum(list.map((r) => r.claims));
    const noAnswer = sum(list.map((r) => r.noAnswer));
    const fcs = list.map((r) => r.firstClaimSec).filter((x): x is number => x !== null);
    return {
      key,
      name: names[key] ?? key,
      claims,
      confirmed: sum(list.map((r) => r.confirmed)),
      rejected: sum(list.map((r) => r.rejected)),
      noAnswer,
      noAnswerRate: noAnswerRate({ claims, noAnswer }),
      firstClaimSec: fcs.length ? Math.round(fcs.reduce((s, x) => s + x, 0) / fcs.length) : null,
      stuck48h: list.length ? list[list.length - 1]!.stuck48h : null,
      reactivated: sum(list.map((r) => r.reactivated)),
      daysOfData: list.length,
    };
  });
  const med = median(team.map((t) => t.noAnswerRate).filter((x): x is number => x !== null));
  return {
    days,
    rows: !people ? [] : team.map((t) => ({ ...t, flag: personFlag({ claims: t.claims, noAnswer: t.noAnswer, stuck48h: t.stuck48h, daysOfData: t.daysOfData }, med, rules) })).sort((a, b) => a.name.localeCompare(b.name)),
    reasons: [...reasonSum.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 8),
    total: { claims: sum(team.map((t) => t.claims)), confirmed: sum(team.map((t) => t.confirmed)), rejected: sum(team.map((t) => t.rejected)), noAnswer: sum(team.map((t) => t.noAnswer)), stuck48h: sum(team.map((t) => t.stuck48h)) },
    medianNoAnswer: med,
  };
}

/** The last stock alert that was sent (a `Notification` whose key starts with `stock:`), for the stock page. */
export async function lastStockAlert(): Promise<{ title: string; at: string } | null> {
  if (isDemo(process.env)) return null;
  const n = await db.notification.findFirst({ where: { key: { startsWith: "stock:" } }, orderBy: { createdAt: "desc" }, select: { title: true, createdAt: true } });
  return n ? { title: n.title, at: n.createdAt.toISOString() } : null;
}
