/**
 * The reports: what the jobs said when they finished (the `summary` and the full `report` of a run) and the periodic reports (morning ·
 * weekly · monthly). One row shape for the home page and «الشغل ← التقارير», one page per report.
 */
import { dayBounds } from "@/core/day";
import { isDemo } from "@/core/readiness";
import { isMoneyKey } from "@/core/redact-money";
import { can } from "@/core/roles";
import { db } from "./db";
import { viewerRole } from "./redact";

export interface ReportRow {
  /** `run:<id>` or `report:<id>` */
  id: string;
  kind: "run" | "periodic";
  title: string;
  jobKey: string | null;
  jobNumber: number | null;
  domain: "ads" | "ops" | null;
  /** ok · failed · running · waiting … for a run; null for a periodic report */
  status: string | null;
  at: string;
  summary: string | null;
  /** there is a full text to open */
  hasFull: boolean;
  href: string;
}

const PERIODIC_AR: Record<string, string> = { morning: "التقرير الصباحي", weekly: "التقرير الأسبوعي", monthly: "التقرير الشهري" };
const clip = (s: string | null, n = 160) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);
export const reportHref = (id: string) => `/work/reports/${encodeURIComponent(id)}`;

/** Newest first. `jobKey` keeps one job's runs; `day` (an Amman calendar key) keeps one day. A demo site has none. */
export async function loadReports(opts: { limit?: number; jobKey?: string; domain?: "ads" | "ops"; day?: string } = {}): Promise<ReportRow[]> {
  if (isDemo(process.env)) return [];
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const range = opts.day ? dayBounds(opts.day) : null;
  const when = range ? { gte: range.from, lt: range.to } : undefined;
  const [runs, periodic] = await Promise.all([
    db.workflowRun.findMany({
      where: {
        OR: [{ summary: { not: null } }, { report: { not: null } }],
        ...(opts.jobKey || opts.domain ? { workflow: { ...(opts.jobKey ? { key: opts.jobKey } : {}), ...(opts.domain ? { domain: opts.domain } : {}) } } : {}),
        ...(when ? { startedAt: when } : {}),
      },
      include: { workflow: { select: { key: true, name: true, number: true, domain: true } } },
      orderBy: { startedAt: "desc" },
      take: limit,
    }),
    opts.jobKey || opts.domain ? Promise.resolve([]) : // U-07: only the reports for people (morning · weekly · monthly), and not an empty one — plan · attribution · analysis are the code's data, not something to read
    db.report.findMany({ where: { kind: { in: ["morning", "weekly", "monthly"] }, empty: false, ...(opts.day ? { forDate: new Date(`${opts.day}T00:00:00Z`) } : {}) }, orderBy: { forDate: "desc" }, take: limit }),
  ]);
  const rows: ReportRow[] = [
    ...runs.map((r) => ({ id: `run:${r.id}`, kind: "run" as const, title: r.workflow.name, jobKey: r.workflow.key, jobNumber: r.workflow.number, domain: r.workflow.domain === "ops" ? ("ops" as const) : ("ads" as const), status: r.status, at: r.startedAt.toISOString(), summary: clip(r.summary), hasFull: !!r.report, href: reportHref(`run:${r.id}`) })),
    ...periodic.map((p) => ({ id: `report:${p.id}`, kind: "periodic" as const, title: PERIODIC_AR[p.kind] ?? p.kind, jobKey: null, jobNumber: null, domain: null, status: null, at: p.createdAt.toISOString(), summary: clip(p.text), hasFull: true, href: reportHref(`report:${p.id}`) })),
  ];
  // a role sees the reports of the areas it may look at; the general ones (morning, weekly, monthly) carry profit, so they need `money.view`
  const role = await viewerRole();
  const mine = role ? rows.filter((r) => (r.kind === "periodic" ? can(role, "money.view") : can(role, r.domain === "ops" ? "ops.view" : "ads.view"))) : rows;
  return mine.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}

export interface ReportDetail {
  id: string;
  title: string;
  jobKey: string | null;
  jobNumber: number | null;
  status: string | null;
  at: string;
  finishedAt: string | null;
  summary: string | null;
  /** the full text */
  text: string | null;
  metrics: { label: string; value: string }[];
  artifacts: { label: string; url: string | null; text: string | null }[];
}

/** One report by its id (`run:…` or `report:…`), or null. */
export async function getReport(id: string): Promise<ReportDetail | null> {
  if (isDemo(process.env)) return null;
  const m = /^(run|report):(.+)$/.exec(id);
  if (!m) return null;
  const role = await viewerRole();
  if (m[1] === "report") {
    if (role && !can(role, "money.view")) return null;
    const p = await db.report.findUnique({ where: { id: m[2]! } });
    return p ? { id, title: PERIODIC_AR[p.kind] ?? p.kind, jobKey: null, jobNumber: null, status: null, at: p.createdAt.toISOString(), finishedAt: null, summary: null, text: p.text, metrics: [], artifacts: [] } : null;
  }
  const r = await db.workflowRun.findUnique({ where: { id: m[2]! }, include: { workflow: { select: { key: true, name: true, number: true, domain: true } } } });
  if (!r) return null;
  if (role && !can(role, r.workflow.domain === "ops" ? "ops.view" : "ads.view")) return null;
  const metrics = r.metrics && typeof r.metrics === "object" && !Array.isArray(r.metrics) ? Object.entries(r.metrics as Record<string, unknown>).filter(([label]) => !role || can(role, "money.view") || !isMoneyKey(label)).map(([label, value]) => ({ label, value: String(value) })) : [];
  const artifacts = Array.isArray(r.artifacts) ? (r.artifacts as { label?: string; url?: string; text?: string }[]).filter((a) => a?.label).map((a) => ({ label: String(a.label), url: a.url ?? null, text: a.text ?? null })) : [];
  return { id, title: r.workflow.name, jobKey: r.workflow.key, jobNumber: r.workflow.number, status: r.status, at: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null, summary: r.summary, text: r.report, metrics, artifacts };
}
