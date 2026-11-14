/**
 * NON-BLOCKING ALERTS (v4 · A `notify`): an urgency (🔴 🟠 🟡), an audience (the owner or a person), a title. It is stored
 * first — it shows in «اليوم» whatever happens to the delivery — then sent on Telegram when that is linked.
 *
 * Delivery follows the owner's switch: while he is awake 🔴 and 🟠 go out (🟡 never does — it is silent by definition);
 * while he sleeps nothing goes to his phone, it waits for the «صباح الخير» card. A person other than the owner is reached
 * on the Telegram chat the owner gave for them (setting `notify.contacts`), never on a guess.
 * Money is never approved from here — a message only says «افتح الموقع».
 */
import { Prisma } from "@prisma/client";
import { effectiveMode, type Urgency } from "@/core/mode";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";
import { db } from "./db";
import { appOrigin } from "./env";
import { getSetting } from "./settings";

export const URGENCY_ICON: Record<Urgency, string> = { red: "🔴", orange: "🟠", yellow: "🟡" };

export interface NotifyInput {
  urgency: Urgency;
  audience?: string;
  title: string;
  body?: string;
  href?: string;
  source?: string;
  /** the same alert twice is one (per audience) */
  key?: string;
}

export async function createNotification(i: NotifyInput): Promise<{ id: string; created: boolean }> {
  const audience = i.audience ?? "owner";
  if (i.key) {
    const found = await db.notification.findUnique({ where: { audience_key: { audience, key: i.key } } });
    if (found) return { id: found.id, created: false };
  }
  try {
    const row = await db.notification.create({ data: { urgency: i.urgency, audience, title: i.title.slice(0, 200), body: i.body?.slice(0, 600) ?? null, href: i.href ?? null, source: i.source ?? "mcp", key: i.key ?? null } });
    return { id: row.id, created: true };
  } catch (e) {
    // two identical alerts at once: the second finds the first
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002" && i.key) {
      const found = await db.notification.findUnique({ where: { audience_key: { audience, key: i.key } } });
      if (found) return { id: found.id, created: false };
    }
    throw e;
  }
}

export interface Delivery {
  delivered: boolean;
  via?: "telegram";
  reason?: string;
}

/** Sends a stored notification if the owner's switch, the urgency and the links allow it. Never throws. */
export async function dispatchNotification(id: string, now = new Date()): Promise<Delivery> {
  try {
    const n = await db.notification.findUnique({ where: { id } });
    if (!n) return { delivered: false, reason: "مش موجود" };
    if (n.sentAt) return { delivered: true, via: "telegram" };
    if (n.urgency === "yellow") return { delivered: false, reason: "🟡 صامت: بيظهر بـ «اليوم» بس" };
    const tg = telegramFromEnv();
    if (!tg) return { delivered: false, reason: "تيليجرام مش مربوط لسا" };
    let chatId = tg.chatId;
    if (n.audience === "owner") {
      if (effectiveMode(await getSetting("owner.mode"), now) === "asleep") return { delivered: false, reason: "المالك نايم — بيطلع بكرت «صباح الخير»" };
    } else {
      const contact = (await getSetting("notify.contacts"))[n.audience];
      if (!contact) return { delivered: false, reason: `ما في رقم تيليجرام لـ ${n.audience} — حطه من الإعدادات` };
      chatId = contact;
    }
    const link = n.href ? `\n${appOrigin()}${n.href.startsWith("/") ? n.href : `/${n.href}`}` : "";
    await sendTelegram({ ...tg, chatId }, `${n.title}${n.body ? `\n${n.body}` : ""}${link}`);
    await db.notification.update({ where: { id }, data: { sentAt: now } });
    return { delivered: true, via: "telegram" };
  } catch (e) {
    console.error("notification dispatch failed:", e instanceof Error ? e.message : e);
    return { delivered: false, reason: "ما انبعت — الإشعار انحفظ وبيظهر بالموقع" };
  }
}
