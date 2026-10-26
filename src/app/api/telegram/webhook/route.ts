import { NextResponse } from "next/server";
import { db } from "@/server/db";
import { safeEqual } from "@/server/crypto";
import { propose } from "@/server/changes";
import { audit } from "@/server/audit";
import { creativeCodeOf, HELP_AR, parseTelegram } from "@/core/telegram-command";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";

export const dynamic = "force-dynamic";

const SITE = () => process.env.APP_URL ?? "https://mediabuyer.zakiai.io";

/**
 * POST /api/telegram/webhook — Telegram calls this (setWebhook with secret_token = TELEGRAM_WEBHOOK_SECRET).
 * Only the owner's and the allowed chat ids are heard. «اوقف» becomes a safety change set (executed, logged, undoable
 * from the site); anything that spends is refused with a link to the site.
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
    await reply(`${cmd.what} من الموقع بس، بعد ما تشوف الأثر المالي: ${SITE()}/decisions`);
    return NextResponse.json({ ok: true });
  }
  if (process.env.MOCK_MODE === "1") {
    await reply("الوضع التجريبي: ما وقفت شي فعلاً.");
    return NextResponse.json({ ok: true });
  }

  // find what to pause: a creative code, else a name (ad, ad set, campaign) containing the words
  const code = creativeCodeOf(cmd.query);
  const ads = await db.ad.findMany({ where: code ? { creativeCode: code, status: { not: "PAUSED" } } : { name: { contains: cmd.query, mode: "insensitive" }, status: { not: "PAUSED" } }, include: { adSet: { include: { campaign: { include: { account: true } } } } }, take: 6 });
  const adsets = ads.length ? [] : await db.adSet.findMany({ where: { name: { contains: cmd.query, mode: "insensitive" }, status: { not: "PAUSED" } }, include: { campaign: { include: { account: true } } }, take: 6 });
  const campaigns = ads.length || adsets.length ? [] : await db.campaign.findMany({ where: { name: { contains: cmd.query, mode: "insensitive" }, status: { not: "PAUSED" } }, include: { account: true }, take: 6 });
  const hits = [
    ...ads.map((a) => ({ type: "ad" as const, id: a.metaId, name: a.name, account: a.adSet.campaign.account.metaId, status: a.status })),
    ...adsets.map((s) => ({ type: "adset" as const, id: s.metaId, name: s.name, account: s.campaign.account.metaId, status: s.status })),
    ...campaigns.map((c) => ({ type: "campaign" as const, id: c.metaId, name: c.name, account: c.account.metaId, status: c.status })),
  ];
  if (hits.length === 0) {
    await reply(`ما لقيت شي شغّال اسمه «${cmd.query}». جرّب رقم الفيديو متل: اوقف CR00147`);
    return NextResponse.json({ ok: true });
  }
  if (hits.length > 1 && !code) {
    await reply(`لقيت ${hits.length} — حدّد أكتر:\n${hits.map((h) => `• ${h.name}`).join("\n")}`);
    return NextResponse.json({ ok: true });
  }
  const accounts = new Set(hits.map((h) => h.account));
  const cs = await propose(
    {
      source: "telegram",
      sourceRef: chatId,
      reasonCode: "S11",
      sentence: `وقف من تيليجرام: ${hits.map((h) => h.name).join("، ")}`,
      kind: "safety_pause",
      accountMetaId: accounts.size === 1 ? [...accounts][0]! : null,
      items: hits.map((h) => ({ op: "pause", objectType: h.type, objectId: h.id, before: { status: h.status }, after: { status: "PAUSED" } })),
    },
    { type: "user", id: `telegram:${chatId}` },
  );
  await audit({ type: "user", id: `telegram:${chatId}` }, "telegram.pause", { type: "changeset", id: cs.id });
  await reply(cs.state === "executed" ? `✓ وقف: ${hits.map((h) => h.name).join("، ")}\nبترجعه من الموقع: ${SITE()}/decisions` : `انسجّل الطلب وبانتظار مراجعة بالموقع: ${SITE()}/decisions`);
  return NextResponse.json({ ok: true });
}
