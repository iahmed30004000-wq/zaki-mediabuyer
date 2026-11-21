/**
 * THE READINESS PANEL's data (v3 · R, on «الإعدادات ← الربط»; `/setup` lands there): for every link — is its key there (the
 * NAMES of what is missing, never a value), and when did a REAL call last happen and how did it end. A job that ran but
 * only said «skipped» is not a real call. Read-only, and never lets a database that does not answer take the screen down.
 */
import { INTEGRATIONS, isDemo, metaWriteGate, missingGroups, type Integration } from "@/core/readiness";
import { N8N_CREATOR } from "@/core/n8n-starters";
import { metaToken } from "@/jobs/meta-sync";
import { assistantConfigured, externalModelsOff } from "@/server/assistant/config";
import { db } from "@/server/db";
import { envProblems, type EnvProblem } from "@/core/env-check";

export interface LastCall {
  /** ISO time of the last real call, or null when there never was one */
  at: string | null;
  /** how it ended; null when there was no call */
  ok: boolean | null;
  /** a short line: what the call was, or why it failed (an error already in words, cut short) */
  what: string | null;
}

export interface ReadinessRow {
  key: string;
  label: string;
  why: string;
  writes: boolean;
  later: boolean;
  /** the key is there (and, for writes to Meta, the gate is open) */
  linked: boolean;
  /** what is missing, as names (never values): «A أو B» is one group */
  missing: string[];
  last: LastCall;
}

export interface Readiness {
  demo: boolean;
  rows: ReadinessRow[];
  /** the variables production cannot do without that are missing or weak (names only; empty in development) */
  env: EnvProblem[];
  /** the Meta write lock, said in one line */
  metaWrite: { mode: "dry_run" | "live"; line: string };
}

const NONE: LastCall = { at: null, ok: null, what: null };
const short = (s: string | null | undefined, n = 140) => (s ? s.replace(/\s+/g, " ").slice(0, n) : null);

/** The newest worker run of these jobs that really did something: it failed, or it finished without saying «skipped». */
async function lastJob(jobs: string[]): Promise<LastCall> {
  if (!jobs.length) return NONE;
  const runs = await db.jobRun.findMany({ where: { job: { in: jobs }, status: { in: ["ok", "failed"] } }, orderBy: { finishedAt: "desc" }, take: 12, select: { job: true, status: true, finishedAt: true, error: true, stats: true } });
  for (const r of runs) {
    const skipped = r.status === "ok" && !!(r.stats as { skipped?: unknown } | null)?.skipped;
    if (skipped || !r.finishedAt) continue;
    return { at: r.finishedAt.toISOString(), ok: r.status === "ok", what: r.status === "ok" ? r.job : short(r.error) };
  }
  return NONE;
}

async function lastProbe(i: Integration): Promise<LastCall> {
  switch (i.probe) {
    case "telegram": {
      const [n, r] = await Promise.all([db.notification.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } }), db.report.findFirst({ where: { sentAt: { not: null } }, orderBy: { sentAt: "desc" }, select: { sentAt: true } })]);
      const at = [n?.sentAt, r?.sentAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
      return at ? { at: at.toISOString(), ok: true, what: "رسالة وصلت" } : NONE;
    }
    case "telegramIn": {
      const c = await db.changeSet.findFirst({ where: { source: "telegram" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, state: true } });
      return c ? { at: c.createdAt.toISOString(), ok: c.state !== "failed", what: "أمر «اوقف» وصل" } : NONE;
    }
    case "assistant": {
      const r = await db.agentRun.findFirst({ where: { agent: "M12" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, ok: true, error: true, model: true } });
      return r ? { at: r.createdAt.toISOString(), ok: r.ok, what: r.ok ? r.model : short(r.error) } : NONE;
    }
    case "n8n": {
      const [h, a] = await Promise.all([db.handoff.findFirst({ where: { createdBy: N8N_CREATOR }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }), db.auditLog.findFirst({ where: { action: "workflow.execute" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } })]);
      const best = [h && { at: h.createdAt, what: "n8n طلب تشغيل" }, a && { at: a.createdAt, what: "الموقع نفّذ خطوات" }].filter((x): x is { at: Date; what: string } => !!x).sort((x, y) => y.at.getTime() - x.at.getTime())[0];
      return best ? { at: best.at.toISOString(), ok: true, what: best.what } : NONE;
    }
    case "hermes": {
      const r = await db.videoRequest.findFirst({ where: { via: { in: ["api", "telegram"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true, via: true } });
      return r ? { at: r.createdAt.toISOString(), ok: true, what: r.via === "api" ? "طلب انبعت بالـ API" : "طلب انبعت بتيليجرام" } : NONE;
    }
    default:
      return NONE;
  }
}

async function lastMetaWrite(): Promise<LastCall> {
  const [cs, up] = await Promise.all([db.changeSet.findFirst({ where: { writeMode: "live", state: { in: ["executed", "failed"] } }, orderBy: { createdAt: "desc" }, select: { executedAt: true, createdAt: true, state: true, error: true } }), lastJob(["meta.upload"])]);
  const a: LastCall | null = cs ? { at: (cs.executedAt ?? cs.createdAt).toISOString(), ok: cs.state === "executed", what: cs.state === "executed" ? "تغيير انكتب على ميتا" : short(cs.error) } : null;
  return [a, up.at ? up : null].filter((x): x is LastCall => !!x).sort((x, y) => (y.at ?? "").localeCompare(x.at ?? ""))[0] ?? NONE;
}

export async function loadReadiness(env: Record<string, string | undefined> = process.env): Promise<Readiness> {
  const token = await metaToken().then((t) => t !== null, () => false);
  const gate = metaWriteGate(env, token);
  const rows: ReadinessRow[] = [];
  for (const i of INTEGRATIONS) {
    let missing = missingGroups(i, env);
    // the token may be the encrypted connection in the database
    if ((i.key === "meta" || i.key === "metaWrite") && token) missing = missing.filter((m) => m !== "META_SYSTEM_USER_TOKEN");
    if (i.key === "metaWrite") {
      missing = [];
      if (!token) missing.push("META_SYSTEM_USER_TOKEN");
      if (env.META_WRITE_MODE !== "live") missing.push("META_WRITE_MODE=live");
      if (env.META_LIVE_VERIFIED !== "1") missing.push("META_LIVE_VERIFIED=1");
    }
    // the Claude key may be the one linked from the site (encrypted in the database)
    if (i.key === "assistant" && missing.length && (await assistantConfigured())) missing = [];
    if (i.key === "assistant" && !missing.length && externalModelsOff()) missing = ["PRIVACY_MODE=off (هلأ internal_only)"];
    let last: LastCall = NONE;
    try {
      last = i.key === "metaWrite" ? await lastMetaWrite() : i.probe && i.probe !== "none" ? await lastProbe(i) : await lastJob(i.jobs);
    } catch {
      last = NONE;
    }
    rows.push({ key: i.key, label: i.label, why: i.why, writes: i.writes, later: !!i.later, linked: missing.length === 0, missing, last });
  }
  const line =
    gate.mode === "live" ? "حقيقية — كل قرار بيوصل لميتا" : gate.error ? gate.error : "تجريبية (dry-run) — كل قرار بيسجّل شو كان رح ينبعت وما بينبعت. بتتفتح بـ META_WRITE_MODE=live و META_LIVE_VERIFIED=1 بعد فحص الحساب التجريبي";
  return { demo: isDemo(env), rows, env: envProblems(env, process.env.NODE_ENV === "production"), metaWrite: { mode: gate.mode, line } };
}
