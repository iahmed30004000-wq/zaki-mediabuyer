/**
 * The reports list: what the jobs said when they finished (the `summary` of a run) and the periodic reports (morning · weekly · monthly).
 * One row shape for the home page and «الشغل ← التقارير». The full text of a run's report arrives with P5 (`WorkflowRun.report`).
 */
import { dayBounds } from "@/core/day";
import { isDemo } from "@/core/readiness";
import { db } from "./db";

export interface ReportRow {
  /** `run:<id>` or `report:<id>` */
  id: string;
  kind: "run" | "periodic";
  title: string;
  jobKey: string | null;
  /** ok · failed · running … for a run; null for a periodic report */
  status: string | null;
  at: string;
  summary: string | null;
  href: string;
}

const PERIODIC_AR: Record<string, string> = { morning: "التقرير الصباحي", weekly: "التقرير الأسبوعي", monthly: "التقرير الشهري" };
const clip = (s: string | null, n = 160) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Newest first. `jobKey` keeps one job's runs; `day` (an Amman calendar key) keeps one day. A demo site has none. */
export async function loadReports(opts: { limit?: number; jobKey?: string; day?: string } = {}): Promise<ReportRow[]> {
  if (isDemo(process.env)) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const range = opts.day ? dayBounds(opts.day) : null;
  const when = range ? { gte: range.from, lt: range.to } : undefined;
  const [runs, periodic] = await Promise.all([
    db.workflowRun.findMany({
      where: { summary: { not: null }, ...(opts.jobKey ? { workflow: { key: opts.jobKey } } : {}), ...(when ? { startedAt: when } : {}) },
      include: { workflow: { select: { key: true, name: true } } },
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    opts.jobKey ? Promise.resolve([]) : db.report.findMany({ where: opts.day ? { forDate: new Date(`${opts.day}T00:00:00Z`) } : {}, orderBy: { forDate: "desc" }, take: limit }),
  ]);
  const rows: ReportRow[] = [
    ...runs.map((r) => ({ id: `run:${r.id}`, kind: "run" as const, title: r.workflow.name, jobKey: r.workflow.key, status: r.status, at: r.startedAt.toISOString(), summary: clip(r.summary), href: `/work/job/${encodeURIComponent(r.workflow.key)}` })),
    ...periodic.map((p) => ({ id: `report:${p.id}`, kind: "periodic" as const, title: PERIODIC_AR[p.kind] ?? p.kind, jobKey: null, status: null, at: p.createdAt.toISOString(), summary: clip(p.text), href: `/work/reports?r=${p.id}` })),
  ];
  return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
