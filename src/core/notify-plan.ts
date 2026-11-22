/**
 * WHAT HAPPENS TO A NOTICE ON THE WAY TO THE PHONE — pure (docs/rebuild-v6/05-notify.md §2–§4). A notice is a `Notification` row; the dispatcher
 * (src/jobs/notify-dispatch.ts) asks `planDelivery` what to do with it and carries it out. Nothing here touches the network or the database.
 *
 *   «بيرنّ»      a phone notification with a sound that stays on the screen
 *   «صامت»      a phone notification without a sound
 *   «بالموقع»   the bell only
 *
 * Asleep (the owner's switch, src/core/mode.ts): what would sound waits and comes as ONE notice when he wakes — except a red decision of a kind he marked
 * «يصحّيني». More than five notices in ten minutes are one. The same notice twice is one already (the unique key of the row).
 */
import type { Urgency } from "./mode";

export type NotifyPref = "ring" | "silent" | "site";
export const NOTIFY_PREFS: readonly NotifyPref[] = ["ring", "silent", "site"];
export type PrefsMap = Readonly<Record<string, NotifyPref>>;

/** What the settings page lists: the kinds of notice the owner chooses for, in the owner's words. `example` is what the title looks like. */
export interface NotifyKindInfo {
  kind: string;
  /** the line in the table */
  label: string;
  example: string;
  /** the choice when he has not made one */
  pref: NotifyPref;
  /** asleep: «wake» rings only when the owner marked its kind · «hold» waits for the morning · «pass» is not held at all (it is silent and harmless) */
  asleep: "wake" | "hold" | "pass";
}

export const KIND_TABLE: readonly NotifyKindInfo[] = [
  { kind: "approval.new", label: "قرار بدّه منك", example: "بدّها قرارك: تكبير «حرير 3» +20%", pref: "ring", asleep: "wake" },
  { kind: "run.stuck", label: "مهمة واقفة", example: "جولة الليل واقفة", pref: "ring", asleep: "hold" },
  { kind: "run.missed", label: "مهمة فاتت", example: "جولة الفريق فاتت 14:00", pref: "ring", asleep: "hold" },
  { kind: "run.failed", label: "مهمة فشلت أو انقطعت", example: "جولة الليل فشلت", pref: "ring", asleep: "hold" },
  { kind: "run.done", label: "مهمة خلصت", example: "جولة الليل خلصت", pref: "site", asleep: "hold" },
  { kind: "stock.red", label: "مخزون قليل", example: "«كمأة» بتكفي 5 أيام", pref: "silent", asleep: "hold" },
  { kind: "report.morning", label: "تقرير الصبح", example: "تقرير الصبح جاهز", pref: "silent", asleep: "pass" },
  { kind: "backup.failed", label: "النسخة الاحتياطية أو السحب ما اشتغل", example: "النسخة الاحتياطية ما اشتغلت", pref: "ring", asleep: "hold" },
  { kind: "agent.silent", label: "وكيل ساكت", example: "Claude الرئيسي ساكت من 3 ساعات", pref: "silent", asleep: "hold" },
];

/** Kinds that are the same line on the settings page and the same choice: «run.lost» is «run.failed», the two alike are one row. */
const ALIAS: Readonly<Record<string, string>> = {
  "run.lost": "run.failed",
  "stock.orange": "stock.red",
  "worker.down": "backup.failed",
  "sync.failed": "backup.failed",
};
export const canonicalKind = (kind: string): string => ALIAS[kind] ?? kind;

/** A notice that has no kind (an older row, or an agent's own `notify`) is told by its colour: red rings, orange is silent, yellow stays on the site. */
const BY_URGENCY: Readonly<Record<Urgency, NotifyPref>> = { red: "ring", orange: "silent", yellow: "site" };

export interface PlanInput {
  kind: string | null;
  urgency: string;
  /** for a decision: the owner marked its kind «يصحّيني» */
  wakeOwner?: boolean;
}

const urgencyOf = (u: string): Urgency => (u === "red" || u === "orange" ? u : "yellow");

const infoOf = (kind: string | null): NotifyKindInfo | undefined => (kind ? KIND_TABLE.find((k) => k.kind === canonicalKind(kind)) : undefined);

/** The choice for this notice when the owner has not made one. */
export function defaultPref(n: Pick<PlanInput, "kind" | "urgency">): NotifyPref {
  const u = urgencyOf(n.urgency);
  // a notice about the notices themselves («ما قدرنا نبعتلك») is for the bell: pushing it would go through the very road that failed
  if (n.kind?.startsWith("notify.")) return "site";
  const info = infoOf(n.kind);
  if (!info) return BY_URGENCY[u];
  // a decision: red rings, orange is silent, yellow is only news
  if (info.kind === "approval.new") return u === "red" ? "ring" : u === "orange" ? "silent" : "site";
  return info.pref;
}

/** What he chose for the kind (the page saves one choice per kind), else the default. */
export function prefOf(n: Pick<PlanInput, "kind" | "urgency">, prefs: PrefsMap): NotifyPref {
  if (n.kind?.startsWith("notify.")) return "site";
  const k = n.kind ? canonicalKind(n.kind) : null;
  const own = k ? prefs[k] : undefined;
  return own && NOTIFY_PREFS.includes(own) ? own : defaultPref(n);
}

/** Whatever was stored, checked: only known kinds with a known choice. A broken value is «nothing chosen», never a crash. */
export function normalizePrefs(raw: unknown): Record<string, NotifyPref> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, NotifyPref> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (KIND_TABLE.some((x) => x.kind === k) && typeof v === "string" && (NOTIFY_PREFS as readonly string[]).includes(v)) out[k] = v as NotifyPref;
  }
  return out;
}

export type Channel = "push" | "telegram";

export interface DeliveryPlan {
  /** a notification with a sound that stays on the screen */
  ring: boolean;
  /** the ways to try, in order: the phone first; Telegram only when no phone can be reached (and it is linked) */
  channels: Channel[];
  /** asleep: keep it for the morning */
  hold: boolean;
  /** nothing leaves the site: the bell is the delivery */
  site: boolean;
  /** why it is not going out, in a word for the page (null when it is going) */
  why: "site_only" | "held_asleep" | "no_channel" | null;
}

/**
 * What to do with one notice for one person. `devices` is how many phones can be pushed to (the dispatcher passes 0 while Firebase is not set up, so the plan
 * says «no channel» — honestly — instead of pretending). `opts.telegram` is whether the person's Telegram chat is linked.
 */
export function planDelivery(n: PlanInput, prefs: PrefsMap, mode: "awake" | "asleep", devices: number, _now: Date, opts: { telegram?: boolean } = {}): DeliveryPlan {
  const pref = prefOf(n, prefs);
  if (pref === "site") return { ring: false, channels: [], hold: false, site: true, why: "site_only" };

  const info = infoOf(n.kind);
  const kindAsleep = info?.asleep ?? "hold";
  const ring = pref === "ring";
  if (mode === "asleep" && kindAsleep !== "pass") {
    // the one thing that may sound while he sleeps: a red decision of a kind he marked «يصحّيني», when its choice is to ring
    const wakes = kindAsleep === "wake" && !!n.wakeOwner && ring && urgencyOf(n.urgency) === "red";
    if (!wakes) return { ring: false, channels: [], hold: true, site: false, why: "held_asleep" };
  }
  const channels: Channel[] = devices > 0 ? ["push"] : opts.telegram ? ["telegram"] : [];
  if (devices > 0 && opts.telegram) channels.push("telegram");
  if (!channels.length) return { ring: false, channels: [], hold: false, site: false, why: "no_channel" };
  return { ring, channels, hold: false, site: false, why: null };
}

/** What a tool answers to «did it go?»: never «رنّ التلفون» — only what is true now. */
export type DeliveryWord = "queued" | "held_asleep" | "site_only";

export function deliveryWord(plan: Pick<DeliveryPlan, "site" | "hold" | "channels">): DeliveryWord {
  if (plan.hold) return "held_asleep";
  if (plan.site || !plan.channels.length) return "site_only";
  return "queued";
}

// ─── retry: a minute · 5 · 15 · an hour, then it stops and the bell says so ───

export const RETRY_MINUTES: readonly number[] = [1, 5, 15, 60];
/** A notice that failed this many times stops being tried. */
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** A notice older than this is no longer pushed (a red decision that rang a day late is noise). */
export const FRESH_MS = 24 * 3_600_000;

/** When to try again after the `attempts`-th failure (1 = the first); null = stop. */
export function retryAt(attempts: number, now: Date): Date | null {
  const wait = RETRY_MINUTES[attempts - 1];
  return wait === undefined ? null : new Date(now.getTime() + wait * 60_000);
}

// ─── no spraying: more than five in ten minutes are one ───

export const BURST_WINDOW_MS = 10 * 60_000;
export const BURST_LIMIT = 5;

/** `recent` = how many were pushed to this person in the last ten minutes; `due` = how many are about to be. True = send ONE «N إشعارات جديدة». */
export const isBurst = (recent: number, due: number): boolean => due > 1 && recent + due > BURST_LIMIT;

export const burstText = (n: number): { title: string; body: string } => ({ title: `${n} إشعارات جديدة`, body: "افتح الموقع وشوفهم بالجرس." });

// ─── asleep: one notice when he wakes ───

const GROUP_OF: Readonly<Record<string, "stopped" | "missed" | "decision" | "stock" | "broken">> = {
  "run.stuck": "stopped",
  "run.failed": "stopped",
  "run.lost": "stopped",
  "run.missed": "missed",
  "approval.new": "decision",
  "stock.red": "stock",
  "stock.orange": "stock",
  "backup.failed": "broken",
  "worker.down": "broken",
  "sync.failed": "broken",
};

const WORDS: Readonly<Record<string, readonly [string, string]>> = {
  stopped: ["وقفت", "وقفوا"],
  missed: ["فاتت", "فاتوا"],
  decision: ["قرار", "قرارات"],
  stock: ["مخزون قليل", "مخزون قليل"],
  broken: ["عطل", "أعطال"],
  other: ["تنبيه", "تنبيهات"],
};

/** «وإنت نايم: 2 وقفوا، 1 فاتت» — the night in one line, by count and in the order of what matters. */
export function sleepDigest(kinds: readonly (string | null)[]): { title: string; body: string } {
  const counts = new Map<string, number>();
  for (const k of kinds) {
    const g = (k && GROUP_OF[k]) || "other";
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  const order = ["decision", "stopped", "missed", "broken", "stock", "other"];
  const parts = order.filter((g) => counts.has(g)).map((g) => `${counts.get(g)} ${WORDS[g]![counts.get(g)! === 1 ? 0 : 1]}`);
  let title = `وإنت نايم: ${parts.join("، ")}`;
  if (title.length > 45) title = `وإنت نايم: ${kinds.length} إشعارات`;
  return { title, body: "اضغط تشوف التفاصيل بالموقع." };
}

// ─── the text of a push ───

export const PUSH_TITLE_MAX = 45;
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`);

export interface PushText {
  title: string;
  body: string;
}

/** The phone's text: the title is the thing itself in 45 characters, the second line is the reason (200 at most). Customer data never gets here — the dispatcher refuses it before. */
export const pushText = (n: { title: string; body: string | null }): PushText => ({ title: cut(n.title.trim(), PUSH_TITLE_MAX), body: cut((n.body ?? "").trim(), 200) });

/** Where a tap lands: an address inside the site, else the home. */
export function pushHref(href: string | null | undefined): string {
  const h = (href ?? "").trim();
  return h.startsWith("/") && !h.startsWith("//") && !h.includes("\\") && !/[\u0000-\u001f]/.test(h) ? h.slice(0, 300) : "/";
}

/** The badge on the icon: how many are not read, capped (a number a phone can show). */
export const badgeCount = (unread: number): number => Math.max(0, Math.min(99, Math.floor(unread)));

// ─── an alert of the reading (src/core/alerts.ts) as a notice ───

/** The alert kinds that are one of the kinds of the table; the others are told by their colour. */
const ALERT_KIND: Readonly<Record<string, string>> = { "alert.backup": "backup.failed", "alert.stale": "sync.failed" };
const ALERT_TITLE: Readonly<Record<string, string>> = {
  "alert.no_delivery": "إعلان شغّال بلا ظهور",
  "alert.tracking": "تتبّع الطلبات فيه مشكلة",
  "alert.cpm": "CPM طالع كتير",
  "alert.stale": "مصدر أرقام وقف",
  "alert.replies": "نظام الردود متأخر",
  "alert.backup": "النسخة الاحتياطية متأخرة",
  "alert.env": "إعدادات ناقصة بالموقع",
  "alert.attribution": "الإسناد ضعيف",
  "alert.capi": "ميتا رفضت أحداث تحويل",
  "alert.token": "توكن ميتا",
  "alert.safety": "قرار أمان",
  "alert.approval": "بانتظار موافقتك",
};

/** The notice an alert becomes: its key is the alert's own id (one alert is one notice), danger is red, warning is orange. Info alerts stay on the site and never get here. */
export function alertNotice(a: { id: string; kind: string; tone: string; text: string; href: string | null }): { urgency: "red" | "orange"; kind: string; title: string; body: string; href: string | undefined; key: string } {
  return {
    urgency: a.tone === "danger" ? "red" : "orange",
    kind: ALERT_KIND[a.kind] ?? a.kind,
    title: ALERT_TITLE[a.kind] ?? cut(a.text, PUSH_TITLE_MAX),
    body: a.text.slice(0, 600),
    href: a.href ?? undefined,
    key: `alert:${a.id}`,
  };
}
