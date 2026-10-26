/**
 * alerts.read (every 15 min) and alerts.send (every 5 min) — spec 12.3. The reading gathers the facts, runs the
 * detectors (src/core/alerts.ts) under the two-readings rule, and adds the event alerts (a safety action that ran,
 * a change with spend waiting for approval). The sending puts every unsent danger/warning alert into ONE Telegram
 * message. Info alerts stay on the site. Without Telegram linked, nothing is sent and nothing is lost.
 */
import { db } from "@/server/db";
import { detect, reading, telegramText, type AlertFacts, type Signal } from "@/core/alerts";
import { lastSuccess } from "./runner";
import { sendTelegram, type TelegramOptions } from "@/adapters/telegram";

const DAY = 86_400_000;

function ammanHour(now: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", hour12: false }).format(now));
}

export async function gatherAlertFacts(now = new Date()): Promise<AlertFacts> {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayRows = await db.insightDaily.findMany({ where: { level: "ad", date: today }, select: { objectId: true, impressions: true, spend: true, purchases: true } });
  const imp = new Map(todayRows.map((r) => [r.objectId, r.impressions]));
  const adsets = await db.adSet.findMany({ where: { status: "ACTIVE", dailyBudget: { gt: 0 }, campaign: { status: "ACTIVE" } }, select: { metaId: true, name: true, dailyBudget: true, ads: { where: { status: "ACTIVE" }, select: { metaId: true } } } });
  const week = await db.insightDaily.groupBy({ by: ["date"], where: { level: "ad", date: { gte: new Date(today.getTime() - 7 * DAY), lt: today } }, _sum: { spend: true, impressions: true } });
  const impressionsToday = todayRows.reduce((n, r) => n + r.impressions, 0);
  const spendToday = todayRows.reduce((n, r) => n + Number(r.spend), 0);
  const metaAt = await lastSuccess("meta.sync");
  const omsAt = await lastSuccess("oms.sync");
  const attr = await db.report.findFirst({ where: { kind: "attribution" }, orderBy: { forDate: "desc" }, select: { text: true } });
  const conn = await db.metaConnection.findFirst({ where: { status: { not: "revoked" } }, orderBy: { createdAt: "desc" }, select: { expiresAt: true, status: true } });
  return {
    hour: ammanHour(now),
    adsets: adsets.filter((s) => s.ads.length).map((s) => ({ id: s.metaId, name: s.name, dailyBudget: Number(s.dailyBudget), impressionsToday: s.ads.reduce((n, a) => n + (imp.get(a.metaId) ?? 0), 0) })),
    pixelPurchasesToday: todayRows.reduce((n, r) => n + r.purchases, 0),
    webOrdersToday: await db.attributedOrder.count({ where: { channel: "website", isFake: false, createdAtOms: { gte: today } } }),
    cpmToday: impressionsToday ? (spendToday / impressionsToday) * 1000 : null,
    impressionsToday,
    cpm7: week.filter((d) => (d._sum.impressions ?? 0) >= 1000).map((d) => (Number(d._sum.spend) / (d._sum.impressions ?? 1)) * 1000),
    metaLinked: Boolean(process.env.META_SYSTEM_USER_TOKEN?.trim()),
    omsLinked: Boolean(process.env.OMS_BASE_URL?.trim() && process.env.OMS_TOKEN?.trim()),
    metaAgeHours: metaAt ? (now.getTime() - metaAt.getTime()) / 3_600_000 : null,
    omsAgeHours: omsAt ? (now.getTime() - omsAt.getTime()) / 3_600_000 : null,
    attributedPct: attr ? ((JSON.parse(attr.text) as { attributed_pct?: number | null }).attributed_pct ?? null) : null,
    capiRejectedLastHour: await db.capiEvent.count({ where: { state: "rejected", updatedAt: { gte: new Date(now.getTime() - 3_600_000) } } }),
    tokenDaysLeft: conn?.status === "expired" ? 0 : conn?.expiresAt ? (conn.expiresAt.getTime() - now.getTime()) / DAY : null,
  };
}

/** Event alerts: each safety action that ran and each change with spend waiting — once, at once. */
async function eventSignals(now: Date): Promise<Signal[]> {
  const since = new Date(now.getTime() - 2 * 3_600_000);
  const sets = await db.changeSet.findMany({ where: { createdAt: { gte: since }, OR: [{ source: "rule", state: "executed", kind: { in: ["safety_pause", "safety_reduce"] } }, { state: "pending_approval", spendDeltaDaily: { gt: 0 } }, { state: "pending_approval", kind: { in: ["test_campaign", "safety_net"] } }] }, select: { id: true, state: true, sentence: true, spendDeltaDaily: true } });
  return sets.map((c) =>
    c.state === "executed"
      ? { key: `cs:${c.id}`, kind: "alert.safety", tone: "warn" as const, text: `قرار أمان تنفّذ: ${c.sentence}`, href: "/decisions", instant: true }
      : { key: `cs:${c.id}`, kind: "alert.approval", tone: "warn" as const, text: `بانتظار موافقتك${Number(c.spendDeltaDaily) > 0 ? ` (+${Number(c.spendDeltaDaily)}$ باليوم)` : ""}: ${c.sentence.slice(0, 160)} — من الموقع بس`, href: "/decisions", instant: true },
  );
}

export async function readAlerts(now = new Date()) {
  const signals = [...detect(await gatherAlertFacts(now)), ...(await eventSignals(now))];
  const state = await db.alertState.findMany();
  const { raise, keep } = reading(signals, state, now);
  for (const s of raise) await db.alert.create({ data: { kind: s.kind, tone: s.tone, text: s.text, href: s.href } });
  for (const k of keep) await db.alertState.upsert({ where: { key: k.key }, create: k, update: { count: k.count, lastSeenAt: k.lastSeenAt, raisedAt: k.raisedAt } });
  // a condition that is gone is forgotten (event keys are kept a day so an approval is never announced twice)
  const seen = new Set(keep.map((k) => k.key));
  const gone = state.filter((s) => !seen.has(s.key) && (!s.key.startsWith("cs:") || now.getTime() - s.lastSeenAt.getTime() > DAY)).map((s) => s.key);
  if (gone.length) await db.alertState.deleteMany({ where: { key: { in: gone } } });
  return { signals: signals.length, raised: raise.length };
}

export async function sendAlerts(tg: TelegramOptions | null, now = new Date()) {
  const due = await db.alert.findMany({ where: { sentAt: null, tone: { in: ["danger", "warn"] }, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: "asc" }, take: 30 });
  if (!due.length) return { sent: 0 };
  if (!tg) return { sent: 0, waiting: due.length, skipped: "Telegram not linked yet (P0.7)" };
  await sendTelegram(tg, telegramText(due, process.env.APP_URL?.trim() || null));
  await db.alert.updateMany({ where: { id: { in: due.map((a) => a.id) } }, data: { sentAt: now } });
  return { sent: due.length };
}
