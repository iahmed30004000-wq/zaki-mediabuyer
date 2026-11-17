import { NextResponse } from "next/server";
import { safeEqual } from "@/server/crypto";
import { stopByQuery } from "@/server/stop-by-query";
import { HELP_AR, parseTelegram } from "@/core/telegram-command";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";

export const dynamic = "force-dynamic";

const SITE = () => process.env.APP_URL ?? "https://mediabuyer.zakiai.io";

/**
 * POST /api/telegram/webhook — Telegram calls this (setWebhook with secret_token = TELEGRAM_WEBHOOK_SECRET).
 * Only the owner's and the allowed chat ids are heard. «اوقف» becomes a safety change set (executed, logged, undoable
 * from the site); anything that spends is refused with a link to the site. (The search and the change set are src/server/stop-by-query.ts,
 * shared with the OMS's signed event at /api/inbound/oms.)
 */
export async function POST(req: Request) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const given = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!secret || !safeEqual(given, secret)) return NextResponse.json({ ok: false }, { status: 401 });

  const update = (await req.json().catch(() => null)) as { message?: { chat?: { id?: number }; text?: string } } | null;
  const chatId = String(update?.message?.chat?.id ?? "");
  const allowed = new Set([process.env.TELEGRAM_OWNER_CHAT_ID, ...(process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",")].map((x) => x?.trim()).filter(Boolean));
  if (!chatId || !allowed.has(chatId)) return NextResponse.json({ ok: true }); // silent to strangers

  const tg = telegramFromEnv();
  const reply = async (text: string) => {
    if (tg) await sendTelegram({ ...tg, chatId }, text).catch(() => {});
  };

  const cmd = parseTelegram(update?.message?.text ?? "");
  if (cmd.kind === "help" || cmd.kind === "unknown") {
    await reply(HELP_AR);
    return NextResponse.json({ ok: true });
  }
  if (cmd.kind === "site_only") {
    await reply(`${cmd.what} من الموقع بس، بعد ما تشوف الأثر المالي: ${SITE()}/inbox`);
    return NextResponse.json({ ok: true });
  }
  await reply(await stopByQuery(cmd.query, { id: `telegram:${chatId}` }, chatId));
  return NextResponse.json({ ok: true });
}
