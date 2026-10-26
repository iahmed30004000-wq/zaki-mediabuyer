import { db } from "@/server/db";
import { ask as askWith, providersFromEnv, type ChatMessage, type GatewayDeps } from "./gateway";
import type { ZodType } from "zod";

export { AgentUnavailable } from "./gateway";
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

export function ask<T = string>(agent: string, messages: ChatMessage[], schema?: ZodType<T>): Promise<T> {
  return askWith(liveDeps(), agent, messages, schema);
}
