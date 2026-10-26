import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { ask as askWith, providersFromEnv, type ChatMessage, type GatewayDeps } from "./gateway";
import type { ZodType } from "zod";

export { AgentUnavailable, AGENT_NAMES, AGENTS } from "./gateway";
export type { ChatMessage } from "./gateway";
export { PrivacyRefusal } from "./privacy";

/** Rough cost per 1k tokens of an external provider (internal is free). Set EXTERNAL_MODEL_USD_PER_1K in .env. */
const usdPer1k = () => Number(process.env.EXTERNAL_MODEL_USD_PER_1K ?? "0.002");

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** The gateway wired to the real environment: providers from .env, the AgentRun table as log and cap. */
export function liveDeps(): GatewayDeps {
  return {
    fetch,
    providers: providersFromEnv(),
    privacyMode: process.env.PRIVACY_MODE,
    spentToday: async (agent) => {
      const r = await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { agent, createdAt: { gte: startOfToday() } } });
      return Number(r._sum.costUsd ?? 0);
    },
    log: async (e) => {
      const cost = e.provider === "external" ? ((e.tokensIn + e.tokensOut) / 1000) * usdPer1k() : 0;
      await db.agentRun.create({ data: { agent: e.agent, provider: e.provider, model: e.model, ok: e.ok, blocked: e.blocked ?? null, tokensIn: e.tokensIn, tokensOut: e.tokensOut, costUsd: cost, ms: e.ms, error: e.error ?? null } });
    },
  };
}

export async function ask<T = string>(agent: string, messages: ChatMessage[], schema?: ZodType<T>): Promise<T> {
  const caps = (await getSetting("agents.daily_caps")) as Record<string, number>;
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  return askWith(
    {
      ...liveDeps(),
      dailyCap: async (a) => caps[a],
      monthlyCapUsd: Number(await getSetting("agents.monthly_cap")),
      spentMonth: async () => Number((await db.agentRun.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: monthStart } } }))._sum.costUsd ?? 0),
    },
    agent,
    messages,
    schema,
  );
}

/** Is any model connected at all? Screens use it to say «ما في موديل موصول» instead of failing. */
export const modelConnected = () => providersFromEnv().length > 0;
