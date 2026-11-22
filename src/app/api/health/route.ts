import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { currentCaller } from "@/server/auth";
import { can } from "@/core/roles";
import { encryptionKeyConfigured } from "@/server/crypto";
import { envProblems, omsLinked } from "@/server/env";
import { assistantConfigured, externalModelsOff } from "@/server/assistant/config";
import { workspaceConfigFrom } from "@/core/workspace-door";
import { isDemo } from "@/core/readiness";
import { WORKER_TICK_KEY, publicHealth, tickTime, workerState } from "@/core/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/health — is the system alive. Anyone gets `{ ok, version, worker: { ok } }`: `ok` is the database AND a worker heartbeat newer
 * than 3 minutes. The status code stays 200 while the database answers (the container health check and the CI start-up check read the code,
 * and the worker waits for this very route — a worker that is down must never keep the site from starting). A signed-in owner also gets
 * which links are configured (never their values).
 */
export async function GET() {
  let database = false;
  let tick: Date | null = null;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
    tick = tickTime((await db.setting.findUnique({ where: { key: WORKER_TICK_KEY }, select: { value: true } }))?.value);
  } catch {
    // a missing heartbeat row or a failed read is «no heartbeat»; the database flag above stays as it was
  }
  const facts = { database, version: process.env.APP_VERSION ?? "dev", worker: workerState(tick, new Date()) };
  const status = database ? 200 : 503;
  const me = await currentCaller().catch(() => null);
  if (!me || !can(me.role, "owner_only")) return NextResponse.json(publicHealth(facts), { status });

  const has = (k: string) => Boolean(process.env[k]?.trim());
  const body = {
    ...publicHealth(facts),
    worker: facts.worker,
    mock: isDemo(process.env),
    database,
    encryption: encryptionKeyConfigured(),
    env: { missing: envProblems().map((p) => p.name) },
    links: {
      meta: has("META_SYSTEM_USER_TOKEN"),
      oms: omsLinked(),
      telegram: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_OWNER_CHAT_ID"),
      drive: has("GOOGLE_SERVICE_ACCOUNT_JSON"),
      studioDrive: has("GOOGLE_SERVICE_ACCOUNT_JSON") && has("DRIVE_STUDIO_FOLDER_ID"),
      driveLibrary: has("GOOGLE_SERVICE_ACCOUNT_JSON") && has("DRIVE_PRODUCTION_FOLDER_ID"),
      replies: has("REPLIES_BASE_URL") && has("REPLIES_TOKEN"),
      internalModel: has("INTERNAL_MODEL_BASE_URL"),
      assistant: (await assistantConfigured()) && !externalModelsOff(),
      workspace: workspaceConfigFrom(process.env) !== null,
      stepRunner: has("N8N_BASE_URL") && has("N8N_WEBHOOK_SECRET") && (has("N8N_ALLOWED_PATHS") || has("STEP_HTTP_ALLOW")),
    },
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status });
}
