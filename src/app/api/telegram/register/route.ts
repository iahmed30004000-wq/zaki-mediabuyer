import { NextResponse } from "next/server";
import { registerWebhook, telegramFromEnv, webhookInfo } from "@/adapters/telegram";
import { missingText, isDemo } from "@/core/readiness";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { appOrigin } from "@/server/env";
import { audit } from "@/server/audit";

export const dynamic = "force-dynamic";

/** Where Telegram should send what the owner writes to the bot: the site's own address. Never carries the token. */
const hookUrl = () => `${appOrigin()}/api/telegram/webhook`;

function keys() {
  const tg = telegramFromEnv();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  const why = missingText("telegramIn");
  if (!tg || !secret || why) throw new HttpError(409, why ?? "تيليجرام مش مربوط");
  if (!hookUrl().startsWith("https://")) throw new HttpError(409, "تيليجرام بيقبل https بس — حط APP_URL بعنوان الموقع (https) بـ Coolify");
  return { tg, secret };
}

/** GET /api/telegram/register — is Telegram sending to this site? (the owner only; says the address, pending count, Telegram's last error) */
export async function GET() {
  try {
    await requireCapability("owner_only");
    if (isDemo(process.env)) return NextResponse.json({ ok: true, demo: true });
    const { tg } = keys();
    const info = await webhookInfo(tg).catch(() => {
      throw new HttpError(502, "تيليجرام ما ردّ — جرّب كمان شوي");
    });
    return NextResponse.json({ ok: true, expected: hookUrl(), ...info, registered: info.url === hookUrl() });
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/telegram/register — registers the site's address with Telegram, with the secret from the environment. The owner only. */
export async function POST() {
  try {
    const caller = await requireCapability("owner_only");
    if (isDemo(process.env) || caller.demo) return NextResponse.json({ ok: true, demo: true });
    const { tg, secret } = keys();
    await registerWebhook(tg, hookUrl(), secret).catch(() => {
      throw new HttpError(502, "تيليجرام رفض التسجيل — اتأكد من TELEGRAM_BOT_TOKEN");
    });
    await audit({ type: "user", id: caller.id }, "telegram.register_webhook", { type: "telegram", id: "webhook" }, { after: { url: hookUrl() } });
    return NextResponse.json({ ok: true, url: hookUrl() });
  } catch (e) {
    return errorResponse(e);
  }
}
