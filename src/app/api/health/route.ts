import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { encryptionKeyConfigured } from "@/server/crypto";
import { omsLinked } from "@/server/env";
import { assistantConfigured, externalModelsOff } from "@/server/assistant/config";
import { workspaceConfigFrom } from "@/core/workspace-door";
import { schedulerOn } from "@/core/scheduler";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

/** GET /api/health — is the system alive, and which links are configured (never their values). */
export async function GET() {
  let database = false;
  try {
    await db.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }
  const has = (k: string) => Boolean(process.env[k]?.trim());
  const body = {
    ok: database,
    version: process.env.APP_VERSION ?? "dev",
    mock: isDemo(process.env),
    database,
    encryption: encryptionKeyConfigured(),
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
      scheduler: schedulerOn(process.env),
      stepRunner: has("N8N_BASE_URL") && has("N8N_WEBHOOK_SECRET") && (has("N8N_ALLOWED_PATHS") || has("STEP_HTTP_ALLOW")),
    },
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: database ? 200 : 503 });
}
