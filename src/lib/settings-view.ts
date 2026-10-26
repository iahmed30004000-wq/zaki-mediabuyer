/**
 * The real rows of the settings screen (MOCK_MODE=0): each account's level and whether it may go up, and each
 * agent's spend today against its cap. In demo mode the screen keeps its demo rows (null here).
 */
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { levelChange, type AutonomyLevel } from "@/core/autonomy";
import { accountRestricted } from "@/jobs/account-safety";
import { AGENT_NAMES, AGENTS } from "@/gateway";

export interface LevelRow {
  metaId: string;
  name: string;
  level: number;
  dailyCap: number | null;
  restricted: boolean;
  /** for each target level 0–3: allowed, and why not */
  options: { level: number; ok: boolean; why: string }[];
}

export interface AgentRow {
  code: string;
  name: string;
  internalOnly: boolean;
  todayUsd: number;
  capUsd: number;
  runsToday: number;
  failedToday: number;
}

export async function loadSettingsView(): Promise<{ levels: LevelRow[]; agents: AgentRow[]; monthUsd: number; monthCap: number; modelConnected: boolean } | null> {
  if (process.env.MOCK_MODE === "1") return null;
  const levels: LevelRow[] = [];
  for (const a of await db.adAccount.findMany({ orderBy: { name: "asc" } })) {
    const first = await db.changeSet.findFirst({ where: { accountMetaId: a.metaId }, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const days = first ? Math.floor((Date.now() - first.createdAt.getTime()) / 86_400_000) : 0;
    const restricted = await accountRestricted(a.metaId);
    levels.push({
      metaId: a.metaId,
      name: a.name,
      level: a.autonomyLevel,
      dailyCap: a.dailyCap ? Number(a.dailyCap) : null,
      restricted,
      options: [0, 1, 2, 3].map((l) => ({ level: l, ...levelChange(a.autonomyLevel as AutonomyLevel, l, { daysOfDecisions: days, restricted }) })),
    });
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const month = new Date(today);
  month.setDate(1);
  const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
  const runs = await db.agentRun.groupBy({ by: ["agent", "ok"], where: { createdAt: { gte: today } }, _sum: { costUsd: true }, _count: true });
  const agents = Object.values(AGENTS).map((p) => {
    const mine = runs.filter((r) => r.agent === p.code);
    return {
      code: p.code,
      name: AGENT_NAMES[p.code] ?? p.code,
      internalOnly: p.internalOnly,
      todayUsd: mine.reduce((n, r) => n + Number(r._sum.costUsd ?? 0), 0),
      capUsd: caps[p.code] ?? p.dailyCapUsd,
      runsToday: mine.reduce((n, r) => n + r._count, 0),
      failedToday: mine.filter((r) => !r.ok).reduce((n, r) => n + r._count, 0),
    };
  });
  const monthUsd = Number((await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: month } } }))._sum.costUsd ?? 0);
  const { modelConnected } = await import("@/gateway");
  return { levels, agents, monthUsd, monthCap: Number(await getSetting("agents.monthly_cap")), modelConnected: modelConnected() };
}
