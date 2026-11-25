/**
 * alerts.read (every 15 min) and alerts.send (every 5 min) — spec 12.3. The reading gathers the facts, runs the
 * detectors (src/core/alerts.ts) under the two-readings rule, and adds the event alerts (a safety action that ran,
 * a change with spend waiting for approval). The sending (`queueAlerts`) writes a notice for every unsent danger/warning
 * alert, and the one sender (src/jobs/notify-dispatch.ts) takes it from there. Info alerts stay on the site.
 */
import { BASE_CURRENCY } from "@/core/currency";
import { db } from "@/server/db";
import { spendConverter } from "@/server/money";
import { envProblems, omsLinked } from "@/server/env";
import { detect, reading, type AlertFacts, type Signal } from "@/core/alerts";
import { alertNotice } from "@/core/notify-plan";
import { createNotification } from "@/server/notify";
import { lastSuccess } from "./runner";
import { reachedMeta } from "@/core/reached-meta";

const DAY = 86_400_000;

function ammanHour(now: Date) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Amman", hour: "2-digit", hour12: false }).format(now));
}

const unitOf = (currency: string | undefined) => (currency && currency !== BASE_CURRENCY ? { unit: currency } : {});

export async function gatherAlertFacts(now = new Date()): Promise<AlertFacts> {
  const today = new Date(now);
  today.setUTCHours(0, 0, 0, 0);
  const todayRows = await db.insightDaily.findMany({ where: { level: "ad", date: today }, select: { objectId: true, impressions: true, spend: true, currency: true, source: true, purchases: true } });
  const imp = new Map(todayRows.map((r) => [r.objectId, r.impressions]));
  const adsets = await db.adSet.findMany({ where: { status: "ACTIVE", dailyBudget: { gt: 0 }, campaign: { status: "ACTIVE" } }, select: { metaId: true, name: true, dailyBudget: true, ads: { where: { status: "ACTIVE" }, select: { metaId: true } } } });
  const weekRows = await db.insightDaily.findMany({ where: { level: "ad", date: { gte: new Date(today.getTime() - 7 * DAY), lt: today } }, select: { objectId: true, date: true, impressions: true, spend: true, currency: true, source: true } });
  const impressionsToday = todayRows.reduce((n, r) => n + r.impressions, 0);
  // v6 · P11: the CPM is dollars; a row with no rate leaves both its spend and its impressions out of it
  const money = await spendConverter();
  const cpmOf = (rows: typeof weekRows) => {
    let spend = 0;
    let impressions = 0;
    for (const r of rows) {
      const c = money.usd(r);
      if (c.usd === null) continue;
      spend += c.usd.toNumber();
      impressions += r.impressions;
    }
    return { impressions, cpm: impressions ? (spend / impressions) * 1000 : null };
  };
  const days = new Map<number, typeof weekRows>();
  for (const r of weekRows) days.set(r.date.getTime(), [...(days.get(r.date.getTime()) ?? []), r]);
  const cpmToday = cpmOf(todayRows.map((r) => ({ ...r, date: today }))).cpm;
  const metaAt = await lastSuccess("meta.sync");
  const omsAt = await lastSuccess("oms.sync");
  const backupAt = (await lastSuccess("db.backup")) ?? (await db.jobRun.findFirst({ orderBy: { startedAt: "asc" }, select: { startedAt: true } }))?.startedAt ?? null;
  const attr = await db.report.findFirst({ where: { kind: "attribution" }, orderBy: { forDate: "desc" }, select: { text: true } });
  const conn = await db.metaConnection.findFirst({ where: { status: { not: "revoked" } }, orderBy: { createdAt: "desc" }, select: { expiresAt: true, status: true } });
  const lastReplies = process.env.REPLIES_BASE_URL?.trim() ? await db.jobRun.findFirst({ where: { job: "replies.sync", status: "ok" }, orderBy: { finishedAt: "desc" }, select: { stats: true } }) : null;
  const repliesStats = (lastReplies?.stats ?? null) as { ok?: boolean; sentence?: string | null } | null;
  return {
    backupAgeHours: backupAt ? (now.getTime() - backupAt.getTime()) / 3_600_000 : null,
    envProblems: envProblems().map((p) => p.name),
    repliesProblem: repliesStats && repliesStats.ok === false ? repliesStats.sentence ?? null : null,
    hour: ammanHour(now),
    adsets: adsets.filter((s) => s.ads.length).map((s) => ({ id: s.metaId, name: s.name, dailyBudget: Number(s.dailyBudget), impressionsToday: s.ads.reduce((n, a) => n + (imp.get(a.metaId) ?? 0), 0), ...unitOf(money.objects.get(s.metaId)) })),
    pixelPurchasesToday: todayRows.reduce((n, r) => n + r.purchases, 0),
    webOrdersToday: await db.attributedOrder.count({ where: { channel: "website", isFake: false, createdAtOms: { gte: today } } }),
    cpmToday,
    impressionsToday,
    cpm7: [...days.entries()].sort(([a], [b]) => a - b).map(([, rows]) => cpmOf(rows)).filter((d) => d.impressions >= 1000 && d.cpm !== null).map((d) => d.cpm!),
    metaLinked: Boolean(process.env.META_SYSTEM_USER_TOKEN?.trim()),
    omsLinked: omsLinked(),
    metaAgeHours: metaAt ? (now.getTime() - metaAt.getTime()) / 3_600_000 : null,
    omsAgeHours: omsAt ? (now.getTime() - omsAt.getTime()) / 3_600_000 : null,
    attributedPct: attr ? ((JSON.parse(attr.text) as { attributed_pct?: number | null }).attributed_pct ?? null) : null,
    capiRejectedLastHour: await db.capiEvent.count({ where: { state: "rejected", updatedAt: { gte: new Date(now.getTime() - 3_600_000) } } }),
    tokenDaysLeft: conn?.status === "expired" ? 0 : conn?.expiresAt ? (conn.expiresAt.getTime() - now.getTime()) / DAY : null,
  };
}

/** R-22: a safety action that only ran as a trial is said so — «تنفّذ» is for what really reached Meta. */
export function safetyAlertText(sentence: string, reached: boolean): string {
  return reached ? `قرار أمان تنفّذ: ${sentence}` : `تجربة: قرار أمان ما انبعت لميتا — ${sentence}`;
}

/** Event alerts: each safety action that ran and each change with spend waiting — once, at once. */
async function eventSignals(now: Date): Promise<Signal[]> {
  const since = new Date(now.getTime() - 2 * 3_600_000);
  const sets = await db.changeSet.findMany({ where: { createdAt: { gte: since }, OR: [{ source: "rule", state: "executed", kind: { in: ["safety_pause", "safety_reduce"] } }, { state: "pending_approval", spendDeltaDaily: { gt: 0 } }, { state: "pending_approval", kind: { in: ["test_campaign", "safety_net"] } }] }, select: { id: true, state: true, sentence: true, spendDeltaDaily: true, writeMode: true } });
  return sets.map((c) =>
    c.state === "executed"
      ? { key: `cs:${c.id}`, kind: "alert.safety", tone: "warn" as const, text: safetyAlertText(c.sentence, reachedMeta({ writeMode: c.writeMode, state: c.state })), href: `/inbox/${encodeURIComponent(`change:${c.id}`)}`, instant: true }
      : { key: `cs:${c.id}`, kind: "alert.approval", tone: "warn" as const, text: `بانتظار موافقتك${Number(c.spendDeltaDaily) > 0 ? ` (+${Number(c.spendDeltaDaily)}$ باليوم)` : ""}: ${c.sentence.slice(0, 160)} — من الموقع بس`, href: `/inbox/${encodeURIComponent(`change:${c.id}`)}`, instant: true },
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

/**
 * alerts.send (every 5 min), v6 · P7: it no longer sends. It writes one `Notification` row per unsent danger/warning alert (key `alert:<id>`, so one alert is one notice however many
 * times this runs) and the one sender (src/jobs/notify-dispatch.ts) takes them from there; the alert's own `sentAt` is written by the sender, when a channel really took the notice.
 * Info alerts stay on the site. Without Telegram or a phone linked nothing is lost: the notice is in the bell and waits.
 */
export async function queueAlerts(now = new Date()) {
  const due = await db.alert.findMany({ where: { sentAt: null, tone: { in: ["danger", "warn"] }, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: "asc" }, take: 100 });
  let written = 0;
  for (const a of due) {
    const r = await createNotification({ ...alertNotice(a), audience: "owner", source: "alert" });
    if (r.created) written += 1;
  }
  return { alerts: due.length, written };
}
