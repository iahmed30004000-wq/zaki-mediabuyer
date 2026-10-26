import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { encryptionKeyConfigured } from "@/server/crypto";

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
    mock: process.env.MOCK_MODE === "1",
    database,
    encryption: encryptionKeyConfigured(),
    links: {
      meta: has("META_SYSTEM_USER_TOKEN"),
      oms: has("OMS_BASE_URL") && has("OMS_TOKEN"),
      telegram: has("TELEGRAM_BOT_TOKEN") && has("TELEGRAM_OWNER_CHAT_ID"),
      drive: has("GOOGLE_SERVICE_ACCOUNT_JSON"),
      internalModel: has("INTERNAL_MODEL_BASE_URL"),
    },
    at: new Date().toISOString(),
  };
  return NextResponse.json(body, { status: database ? 200 : 503 });
}
