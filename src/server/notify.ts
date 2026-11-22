/**
 * NON-BLOCKING ALERTS (v4 · A `notify`): an urgency (🔴 🟠 🟡), an audience (the owner or a person), a title. It is stored
 * first — it shows in the bell whatever happens to the delivery — and the ONE sender (src/jobs/notify-dispatch.ts, v6 · P7) takes it from there: the phone (Firebase),
 * Telegram when no phone can be reached, and the bell for what is only news. Nothing else in the code calls Telegram or Firebase for a notice.
 *
 * Delivery follows the owner's choices per kind and his awake / asleep switch (src/core/notify-plan.ts): what would sound while he sleeps waits for the morning.
 * A person other than the owner is reached on the Telegram chat the owner gave for them (setting `notify.contacts`), never on a guess.
 * Money is never approved from here — a message only says «افتح الموقع».
 */
import { Prisma } from "@prisma/client";
import type { Urgency } from "@/core/mode";
import { db } from "./db";

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
  /** what kind of notice this is (src/core/notify-plan.ts); left out, it is told from the source and the colour */
  kind?: string;
}

/** A notice that did not say its kind: the stock ones are known by their source or their key, the rest by their colour alone. */
export function inferKind(i: Pick<NotifyInput, "kind" | "source" | "key" | "urgency">): string | null {
  if (i.kind) return i.kind.slice(0, 40);
  if (i.source === "stock" || i.key?.startsWith("stock:")) return i.urgency === "red" ? "stock.red" : "stock.orange";
  return null;
}

export async function createNotification(i: NotifyInput): Promise<{ id: string; created: boolean }> {
  const audience = i.audience ?? "owner";
  if (i.key) {
    const found = await db.notification.findUnique({ where: { audience_key: { audience, key: i.key } } });
    if (found) return { id: found.id, created: false };
  }
  try {
    const row = await db.notification.create({ data: { urgency: i.urgency, audience, title: i.title.slice(0, 200), body: i.body?.slice(0, 600) ?? null, href: i.href ?? null, source: i.source ?? "mcp", key: i.key ?? null, kind: inferKind(i) } });
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
  /** it really left on a channel (the phone or Telegram) — a notice that stays in the bell is not «delivered» */
  delivered: boolean;
  via?: "push" | "telegram";
  /** what is true now: queued for the phone · held for the morning · the bell only */
  delivery?: "queued" | "held_asleep" | "site_only";
  reason?: string;
}

/** Sends a stored notification through the one sender, now. Never throws. (The sender also picks everything up on its own every minute.) */
export async function dispatchNotification(id: string, now = new Date()): Promise<Delivery> {
  try {
    const { dispatchOne } = await import("@/jobs/notify-dispatch");
    return await dispatchOne(id, now);
  } catch (e) {
    console.error("notification dispatch failed:", e instanceof Error ? e.message : e);
    return { delivered: false, delivery: "queued", reason: "ما انبعت هلق — الإشعار انحفظ وبيظهر بالموقع وبنعيد المحاولة" };
  }
}
