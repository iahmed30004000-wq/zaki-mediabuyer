/**
 * THE ONE SENDER (docs/rebuild-v6/05-notify.md §2 · §6). Every event writes a `Notification` row; this job — every minute, and at once for a decision or an agent's `notify` — takes
 * the rows that were not sent and does what `planDelivery` (pure, src/core/notify-plan.ts) says: a push to the person's phones through Firebase, Telegram when no phone could be reached,
 * the bell (the row itself) for what is only news. No other code calls Telegram or Firebase for a notice.
 *
 *   • «انبعت» means sent: `sentAt` is written only after a channel took it. A failure raises `attempts` and keeps its reason; it is tried again after a minute, 5, 15, an hour — then it
 *     stops and the bell says «ما قدرنا نبعتلك».
 *   • Firebase not set up (no phone to push to, no key) is not a failure: the row stays, honestly unsent, with the word «no_channel», and goes out the day the setup is done (if it is
 *     still fresh — a notice older than a day is never pushed).
 *   • Asleep, what would sound waits. When he wakes it is ONE notice («وإنت نايم: 2 وقفوا، 1 فاتت»). More than five in ten minutes are one («6 إشعارات جديدة»).
 *   • Two workers never send the same notice: a row is claimed (a compare-and-set on `nextTryAt`) before anything leaves.
 *   • A notice with customer data in it (a phone number, an e-mail, a key) is never pushed.
 */
import type { Notification } from "@prisma/client";
import { effectiveMode } from "@/core/mode";
import {
  BURST_WINDOW_MS,
  FRESH_MS,
  MAX_ATTEMPTS,
  burstText,
  deliveryWord,
  isBurst,
  planDelivery,
  pushHref,
  pushText,
  retryAt,
  sleepDigest,
  type DeliveryPlan,
  type DeliveryWord,
  type PrefsMap,
} from "@/core/notify-plan";
import { refuseIfPrivate } from "@/core/push-rows";
import { sendFcm, fcmFromEnv, type FcmConfig, type PushMessage } from "@/adapters/fcm";
import { sendTelegram, telegramFromEnv, type TelegramOptions } from "@/adapters/telegram";
import { db } from "@/server/db";
import { telegramOf } from "@/server/directory";
import { appOrigin } from "@/server/env";
import { createNotification } from "@/server/notify";
import { activeDevices, getPrefs, markDeviceInvalid, recipientsOf, type ActiveDevice } from "@/server/push-devices";
import { getSetting } from "@/server/settings";
import type { Delivery } from "@/server/notify";

/** The reason kept on a row that is waiting for the morning. */
export const HELD = "held_asleep";
export const NO_CHANNEL = "no_channel";
const RECHECK_MS = 15 * 60_000;
const CLAIM_MS = 5 * 60_000;
const BATCH = 100;

export interface DispatchDeps {
  /** Firebase as the environment holds it (null = not set up) */
  fcm?: FcmConfig | null;
  /** the owner's Telegram bot (null = not linked) */
  telegram?: TelegramOptions | null;
  origin?: string;
}

export interface DispatchStats {
  due: number;
  sent: number;
  held: number;
  siteOnly: number;
  noChannel: number;
  failed: number;
  gaveUp: number;
}

const zero = (): DispatchStats => ({ due: 0, sent: 0, held: 0, siteOnly: 0, noChannel: 0, failed: 0, gaveUp: 0 });

interface Recipient {
  prefs: PrefsMap;
  devices: ActiveDevice[];
}

interface AudienceCtx {
  audience: string;
  mode: "awake" | "asleep";
  recipients: Recipient[];
  telegram: TelegramOptions | null;
}

async function audienceCtx(audience: string, now: Date, deps: Required<Pick<DispatchDeps, "fcm" | "telegram">>): Promise<AudienceCtx> {
  const ids = await recipientsOf(audience);
  const recipients: Recipient[] = [];
  for (const id of ids) recipients.push({ prefs: await getPrefs(id), devices: deps.fcm ? await activeDevices(id) : [] });
  // a notice for somebody with no account is still told by the plan (Telegram, else the bell)
  if (!recipients.length) recipients.push({ prefs: {}, devices: [] });
  let telegram: TelegramOptions | null = null;
  if (deps.telegram) {
    if (audience === "owner") telegram = deps.telegram;
    else {
      const chat = await telegramOf(audience);
      telegram = chat ? { ...deps.telegram, chatId: chat } : null;
    }
  }
  const mode = audience === "owner" ? effectiveMode(await getSetting("owner.mode"), now) : "awake";
  return { audience, mode, recipients, telegram };
}

/** The decision a row waits on: only a decision that is still open is pushed, and a kind he marked «يصحّيني» may ring while he sleeps. */
async function approvalFacts(n: Notification): Promise<{ open: boolean; wakeOwner: boolean } | null> {
  if (n.kind !== "approval.new" || !n.key?.startsWith("approval:")) return null;
  const id = n.key.split(":")[1];
  if (!id) return null;
  const a = await db.approval.findUnique({ where: { id } });
  return a ? { open: a.status === "pending", wakeOwner: a.wakeOwner } : { open: false, wakeOwner: false };
}

interface RowPlan {
  row: Notification;
  plan: DeliveryPlan;
  /** the recipients that will be pushed to */
  go: Recipient[];
  telegramOk: boolean;
}

function planRow(row: Notification, ctx: AudienceCtx, wakeOwner: boolean, now: Date): RowPlan {
  const telegram = ctx.telegram !== null;
  const per = ctx.recipients.map((r) => ({ r, p: planDelivery({ kind: row.kind, urgency: row.urgency, wakeOwner }, r.prefs, ctx.mode, r.devices.length, now, { telegram }) }));
  const go = per.filter((x) => x.p.channels.length > 0);
  if (go.length) {
    const first = go[0]!.p;
    return { row, plan: { ...first, ring: go.some((x) => x.p.ring), channels: go.some((x) => x.p.channels.includes("push")) ? (telegram ? ["push", "telegram"] : ["push"]) : first.channels }, go: go.map((x) => x.r), telegramOk: telegram };
  }
  // nothing to send: waiting for the morning, or only news, or nowhere to go
  const why = per.some((x) => x.p.hold) ? "held_asleep" : per.every((x) => x.p.site) ? "site_only" : "no_channel";
  return { row, plan: { ring: false, channels: [], hold: why === "held_asleep", site: why === "site_only", why }, go: [], telegramOk: false };
}

interface Unit {
  rows: RowPlan[];
  text: { title: string; body: string };
  href: string;
  kind: string;
  ring: boolean;
}

interface SendResult {
  channels: string[];
  /** every try that did not work, as a word */
  errors: string[];
  /** it did reach for a channel (a phone or Telegram): false means there was nowhere left to go */
  tried: boolean;
  /** every phone it reached for was refused for good (gone, or from another project): that is «nowhere to go», not a failure to retry */
  onlyDead: boolean;
}

async function sendUnit(u: Unit, ctx: AudienceCtx, fcm: FcmConfig | null, origin: string, now: Date): Promise<SendResult> {
  const out: SendResult = { channels: [], errors: [], tried: false, onlyDead: false };
  let alive = 0;
  let dead = 0;
  const id = u.rows.length === 1 ? u.rows[0]!.row.id : `${u.kind}-${now.getTime()}`;
  const devices = new Map<string, ActiveDevice>();
  for (const rp of u.rows) for (const r of rp.go) for (const d of r.devices) devices.set(d.id, d);
  if (fcm && devices.size) {
    const msg: PushMessage = { title: u.text.title, body: u.text.body, href: u.href, id, kind: u.kind, ring: u.ring, origin };
    let ok = false;
    for (const d of devices.values()) {
      out.tried = true;
      const r = await sendFcm(fcm, d, msg);
      if (r.ok) {
        ok = true;
        alive += 1;
      } else {
        out.errors.push(r.reason);
        if (r.invalid) {
          dead += 1;
          await markDeviceInvalid(d.id, now);
        } else alive += 1;
      }
    }
    if (ok) out.channels.push("push");
    out.onlyDead = dead > 0 && alive === 0;
  }
  // Telegram: when no phone took it, and only if the plan allowed it (the person's chat is linked)
  if (!out.channels.length && ctx.telegram && u.rows.some((x) => x.telegramOk)) {
    out.tried = true;
    out.onlyDead = false; // Telegram was tried after all: whatever it answers is the answer
    const link = u.href !== "/" ? `\n${origin}${u.href}` : `\n${origin}/`;
    try {
      await sendTelegram(ctx.telegram, `${u.text.title}${u.text.body ? `\n${u.text.body}` : ""}${link}`);
      out.channels.push("telegram");
    } catch (e) {
      // the Telegram adapter's own error says only a status; the token is in the URL, never in the message
      out.errors.push(e instanceof Error ? e.message.replace(/bot[^/\s]*/gi, "bot…").slice(0, 80) : "telegram");
    }
  }
  return out;
}

const word = (errors: string[]): string => [...new Set(errors)].join(",").slice(0, 200) || "failed";

/** Writes the result on the rows of a unit. */
async function settle(u: Unit, res: SendResult, ctx: AudienceCtx, now: Date, stats: DispatchStats): Promise<void> {
  const ids = u.rows.map((x) => x.row.id);
  if (res.channels.length) {
    await db.notification.updateMany({ where: { id: { in: ids } }, data: { sentAt: now, ring: u.ring, channels: res.channels, nextTryAt: null, lastError: null } });
    stats.sent += ids.length;
    // an alert of the reading is «sent» only now that a channel took its notice
    const alertIds = u.rows.map((x) => x.row.key).filter((k): k is string => !!k && k.startsWith("alert:")).map((k) => k.slice("alert:".length));
    if (alertIds.length) await db.alert.updateMany({ where: { id: { in: alertIds } }, data: { sentAt: now } });
    return;
  }
  if (!res.tried || res.onlyDead) {
    // every phone it would have gone to is gone (refused for good just now), and no other way is open: nowhere to go — not a failure
    await db.notification.updateMany({ where: { id: { in: ids } }, data: { nextTryAt: new Date(now.getTime() + RECHECK_MS), lastError: NO_CHANNEL } });
    stats.noChannel += ids.length;
    return;
  }
  for (const rp of u.rows) {
    const attempts = rp.row.attempts + 1;
    const next = retryAt(attempts, now);
    // the last allowed failure closes the row (attempts at the ceiling): it is not tried again, and the bell says so
    await db.notification.update({ where: { id: rp.row.id }, data: { attempts: next ? attempts : MAX_ATTEMPTS, lastError: word(res.errors), nextTryAt: next } });
    stats.failed += 1;
    if (!next) {
      stats.gaveUp += 1;
      await createNotification({ urgency: "orange", audience: ctx.audience, kind: "notify.failed", title: "ما قدرنا نبعتلك إشعار", body: `${rp.row.title.slice(0, 80)} — شوفه بالجرس.`, href: rp.row.href ?? "/", source: "notify", key: `notify.failed:${rp.row.id}` });
    }
  }
}

/** Takes the rows of the units: the ones another worker already took drop out. */
async function claim(rows: RowPlan[], now: Date): Promise<RowPlan[]> {
  const won: RowPlan[] = [];
  for (const rp of rows) {
    const r = await db.notification.updateMany({ where: { id: rp.row.id, sentAt: null, nextTryAt: rp.row.nextTryAt }, data: { nextTryAt: new Date(now.getTime() + CLAIM_MS) } });
    if (r.count === 1) won.push(rp);
  }
  return won;
}

async function processAudience(audience: string, rows: Notification[], now: Date, deps: Required<DispatchDeps>, stats: DispatchStats, only?: { id: string; out: { plan?: DeliveryPlan; sent?: SendResult } }): Promise<void> {
  const ctx = await audienceCtx(audience, now, deps);
  const plans: RowPlan[] = [];
  for (const row of rows) {
    // customer data never goes to a phone: the row stays in the bell and is closed
    const refused = refuseIfPrivate(row.title, row.body);
    if (refused) {
      await db.notification.updateMany({ where: { id: row.id, sentAt: null }, data: { attempts: MAX_ATTEMPTS, lastError: "private_data", nextTryAt: null } });
      stats.gaveUp += 1;
      continue;
    }
    const facts = await approvalFacts(row);
    if (facts && !facts.open) {
      // the decision was answered, expired or withdrawn before it went out: there is nothing left to push
      await db.notification.updateMany({ where: { id: row.id, sentAt: null }, data: { attempts: MAX_ATTEMPTS, lastError: "decided", nextTryAt: null } });
      continue;
    }
    const p = planRow(row, ctx, facts?.wakeOwner ?? false, now);
    if (only?.id === row.id) only.out.plan = p.plan;
    if (p.plan.site) {
      await db.notification.updateMany({ where: { id: row.id, sentAt: null }, data: { sentAt: now, channels: ["site"], ring: false, nextTryAt: null, lastError: null } });
      stats.siteOnly += 1;
    } else if (p.plan.hold) {
      // waiting for the morning: written once so the page can say so
      if (row.lastError !== HELD) await db.notification.updateMany({ where: { id: row.id, sentAt: null }, data: { lastError: HELD } });
      stats.held += 1;
    } else if (!p.plan.channels.length) {
      await db.notification.updateMany({ where: { id: row.id, sentAt: null }, data: { lastError: NO_CHANNEL, nextTryAt: new Date(now.getTime() + RECHECK_MS) } });
      stats.noChannel += 1;
    } else plans.push(p);
  }
  if (!plans.length) return;

  const origin = deps.origin;
  // what woke up: held rows come as one notice
  const woke = plans.filter((p) => p.row.lastError === HELD);
  const fresh = plans.filter((p) => p.row.lastError !== HELD);
  const units: Unit[] = [];
  if (woke.length) units.push({ rows: woke, text: sleepDigest(woke.map((p) => p.row.kind)), href: "/", kind: "digest", ring: false });
  if (fresh.length) {
    const since = new Date(now.getTime() - BURST_WINDOW_MS);
    const recent = (await db.notification.findMany({ where: { audience, sentAt: { gte: since } } })).filter((r) => r.channels.includes("push")).length;
    if (isBurst(recent, fresh.length)) units.push({ rows: fresh, text: burstText(fresh.length), href: "/", kind: "burst", ring: false });
    else for (const p of fresh) units.push({ rows: [p], text: pushText(p.row), href: pushHref(p.row.href), kind: p.row.kind ?? "notice", ring: p.plan.ring });
  }
  for (const u of units) {
    const won = await claim(u.rows, now);
    if (!won.length) continue;
    const unit = { ...u, rows: won };
    const res = await sendUnit(unit, ctx, deps.fcm, origin, now);
    if (only && won.some((x) => x.row.id === only.id)) only.out.sent = res;
    await settle(unit, res, ctx, now, stats);
  }
}

function withDefaults(d: DispatchDeps = {}): Required<DispatchDeps> {
  return { fcm: d.fcm === undefined ? fcmFromEnv() : d.fcm, telegram: d.telegram === undefined ? telegramFromEnv() : d.telegram, origin: d.origin ?? appOrigin() };
}

/** Every minute: sends what is due. */
export async function dispatchDue(now = new Date(), d?: DispatchDeps): Promise<DispatchStats> {
  const deps = withDefaults(d);
  const stats = zero();
  const rows = await db.notification.findMany({
    where: { sentAt: null, attempts: { lt: MAX_ATTEMPTS }, createdAt: { gte: new Date(now.getTime() - FRESH_MS) }, OR: [{ nextTryAt: null }, { nextTryAt: { lte: now } }] },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  stats.due = rows.length;
  const by = new Map<string, Notification[]>();
  for (const r of rows) by.set(r.audience, [...(by.get(r.audience) ?? []), r]);
  for (const [audience, list] of by) {
    try {
      await processAudience(audience, list, now, deps, stats);
    } catch (e) {
      // one audience failing (a database hiccup) must not stop the others; the rows are still unsent and come round again
      console.error("notify dispatch failed:", e instanceof Error ? e.message : e);
    }
  }
  return stats;
}

export interface TestPushResult {
  /** what the page says: «انبعت لـ 2 جهاز» is only said when a phone took it */
  ok: boolean;
  sent: number;
  failed: number;
  reason: "setup_needed" | "no_device" | "refused" | null;
}

/** «جرّب»: a test push to the person's OWN phones — no notice is written (the bell is not cluttered). The same road as any push, so a failure here is a failure there. */
export async function sendTestPush(userId: string, opts: { ring?: boolean } = {}, now = new Date(), d?: DispatchDeps): Promise<TestPushResult> {
  const deps = withDefaults(d);
  if (!deps.fcm) return { ok: false, sent: 0, failed: 0, reason: "setup_needed" };
  const devices = await activeDevices(userId);
  if (!devices.length) return { ok: false, sent: 0, failed: 0, reason: "no_device" };
  const ring = opts.ring === true;
  const msg: PushMessage = { title: "جرّب الإشعار", body: ring ? "هيك بيرنّ القرار الأحمر: صوت وبيضل على الشاشة لحد ما تفتحه." : "إذا شفت هاد، الإشعارات شغّالة على جهازك.", href: "/settings/notifications", id: `test-${now.getTime()}`, kind: "test", ring, origin: deps.origin };
  let sent = 0;
  let failed = 0;
  for (const dev of devices) {
    const r = await sendFcm(deps.fcm, dev, msg);
    if (r.ok) sent += 1;
    else {
      failed += 1;
      if (r.invalid) await markDeviceInvalid(dev.id, now);
    }
  }
  return { ok: sent > 0, sent, failed, reason: sent > 0 ? null : "refused" };
}

/** One notice, now (an agent's `notify`, a decision just asked for). What it answers is what is true: queued · held for the morning · only in the bell. */
export async function dispatchOne(id: string, now = new Date(), d?: DispatchDeps): Promise<Delivery> {
  const deps = withDefaults(d);
  const n = await db.notification.findUnique({ where: { id } });
  if (!n) return { delivered: false, delivery: "site_only", reason: "مش موجود" };
  if (n.sentAt) {
    const via = n.channels.includes("push") ? "push" : n.channels.includes("telegram") ? "telegram" : undefined;
    return { delivered: !!via, via, delivery: via ? "queued" : "site_only" };
  }
  if (n.attempts >= MAX_ATTEMPTS) return { delivered: false, delivery: "site_only", reason: "ما انبعت — بالجرس بس" };
  const out: { plan?: DeliveryPlan; sent?: SendResult } = {};
  const stats = zero();
  await processAudience(n.audience, [n], now, deps, stats, { id, out });
  const plan = out.plan;
  const answer: DeliveryWord = plan ? deliveryWord(plan) : "site_only";
  const channels = out.sent?.channels ?? [];
  if (channels.length) return { delivered: true, via: channels[0] === "telegram" ? "telegram" : "push", delivery: "queued" };
  const why: Record<string, string> = {
    held_asleep: "المالك نايم — بيطلع بإشعار «وإنت نايم» لما يصحى",
    site_only: "بالجرس بالموقع بس (هيك اخترت لهالنوع)",
    no_channel: "ما في جهاز ولا تيليجرام مربوط — انحفظ بالجرس",
  };
  if (plan?.why) return { delivered: false, delivery: answer, reason: why[plan.why] };
  // it went for a channel and the channel did not take it: it is tried again by the clock
  return { delivered: false, delivery: "queued", reason: "ما انبعت هلق — الإشعار انحفظ وبنعيد المحاولة" };
}
