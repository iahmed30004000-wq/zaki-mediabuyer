/**
 * «الفيديوهات» — the board per product (v3 · D), pure: how a video is tied to its ads, how many the bank holds, who ranks
 * as a winner, when one is tired, and how a request to Hermes moves. The code computes; the screen only shows. Nothing here
 * reads a database or a clock.
 *
 *   البنك      every video of the product that is not dropped, against a target of 50
 *   الرابحين   the videos that spent at least the minimum in the last 7 days AND got a real order, cheapest order first
 *   التعب      the cost of a real order over the last 2 complete days is 30% above its own average of the 7 days before
 *   الطلب      طلب ← عند هيرمز ← جاهز ← مرفوع  (or cancelled)
 *
 * Two owner rules this file keeps: a video is never edited, and nothing here classifies a video for policy.
 */
import { addDays } from "./dates";
import { VIDEO_STATUSES } from "./push-rows";

export const BANK_TARGET = 50;
/** The ranking window: the last 7 days, today included. */
export const RANK_DAYS = 7;
/** «cost up 30% vs its own 7-day average»: the latest complete days against the 7 complete days right before them. */
export const FATIGUE = { rise: 0.3, baseDays: 7, recentDays: 2, minBaseOrders: 3 } as const;

export type VideoState = (typeof VIDEO_STATUSES)[number];
export const VIDEO_STATE_AR: Record<VideoState, string> = {
  bank: "بالبنك",
  requested: "مطلوب",
  ready: "جاهز",
  uploaded: "مرفوع",
  testing: "بالتجربة",
  winner: "رابح",
  fatigued: "تعبان",
  dropped: "مستبعد",
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

// ───────────────────────────── the bank: two registries, one list ─────────────────────────────

/** A video of the board: the owner's numbering (JOB · V name) and/or the registry's CR code, with where it lives on Drive. */
export interface BankVideo {
  /** stable: «JOB|V» when the owner numbered it, else its CR code */
  key: string;
  product: string;
  job: string | null;
  vName: string | null;
  crCode: string | null;
  driveFileId: string | null;
  scenarioFileId: string | null;
  metaVideoId: string | null;
  status: VideoState;
  notes: string | null;
}

/** A row of the owner's bank (what Claude pushed with push_videos). */
export interface BankItemIn {
  job: string;
  vName: string;
  productCode: string;
  driveFileId: string | null;
  metaVideoId: string | null;
  scenarioFileId: string | null;
  status: string;
  notes: string | null;
}

/** A row of the registry (the studio and Drive intake). */
export interface AssetIn {
  crCode: string;
  productCode: string | null;
  driveFileId: string | null;
  metaVideoId: string | null;
  status: string;
  dupOf: string | null;
  notes: string | null;
}

const isState = (s: string): s is VideoState => (VIDEO_STATUSES as readonly string[]).includes(s);

/** The registry's statuses in the bank's words (an inbox or review file is already a produced video; an excluded or dead one is out). */
export function assetState(status: string, dupOf: string | null): VideoState {
  if (dupOf) return "dropped";
  switch (status) {
    case "inbox":
    case "review":
      return "bank";
    case "ready":
      return "ready";
    case "uploaded":
      return "uploaded";
    case "live":
    case "paused":
      return "testing";
    case "winner":
      return "winner";
    case "fatigued":
      return "fatigued";
    case "dead":
    case "excluded":
      return "dropped";
    default:
      return "bank";
  }
}

export const videoKey = (job: string, vName: string) => `${job}|${vName}`;

/**
 * The owner's bank and the registry as one list. The same video in both (the same Drive file, or the same Meta video) is
 * ONE row: the owner's numbering, plus the CR code; its status is the bank's, unless the bank still says «بالبنك» and the
 * registry knows better. A video only the registry knows is a row of its own, keyed by its CR code.
 */
export function mergeBank(items: BankItemIn[], assets: AssetIn[]): BankVideo[] {
  const out: BankVideo[] = [];
  const byDrive = new Map<string, BankVideo>();
  const byMeta = new Map<string, BankVideo>();
  for (const i of items) {
    const v: BankVideo = {
      key: videoKey(i.job, i.vName),
      product: i.productCode,
      job: i.job,
      vName: i.vName,
      crCode: null,
      driveFileId: i.driveFileId,
      scenarioFileId: i.scenarioFileId,
      metaVideoId: i.metaVideoId,
      status: isState(i.status) ? i.status : "bank",
      notes: i.notes,
    };
    out.push(v);
    if (i.driveFileId) byDrive.set(i.driveFileId, v);
    if (i.metaVideoId) byMeta.set(i.metaVideoId, v);
  }
  for (const a of assets) {
    const state = assetState(a.status, a.dupOf);
    const same = (a.driveFileId ? byDrive.get(a.driveFileId) : undefined) ?? (a.metaVideoId ? byMeta.get(a.metaVideoId) : undefined);
    if (same) {
      same.crCode ??= a.crCode;
      if (same.status === "bank" && state !== "bank") same.status = state;
      if (a.dupOf) same.status = "dropped";
      continue;
    }
    out.push({ key: a.crCode, product: a.productCode ?? "—", job: null, vName: null, crCode: a.crCode, driveFileId: a.driveFileId, scenarioFileId: null, metaVideoId: a.metaVideoId, status: state, notes: a.notes });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

export interface BankSummary {
  count: number;
  target: number;
  /** 0–100, never above 100 */
  pct: number;
  /** how many are missing to reach the target */
  short: number;
  byState: Partial<Record<VideoState, number>>;
}

/** The bank of one product: everything that is not dropped, against the target. */
export function bankSummary(videos: Pick<BankVideo, "status">[], target = BANK_TARGET): BankSummary {
  const live = videos.filter((v) => v.status !== "dropped");
  const byState: Partial<Record<VideoState, number>> = {};
  for (const v of live) byState[v.status] = (byState[v.status] ?? 0) + 1;
  return { count: live.length, target, pct: target > 0 ? Math.min(100, Math.round((live.length / target) * 100)) : 0, short: Math.max(0, target - live.length), byState };
}

// ───────────────────────────── a video and its ads ─────────────────────────────

export interface AdRef {
  id: string;
  name: string;
  /** CR##### read from the ad's name, when it follows our naming */
  creativeCode: string | null;
  /** the product of the ad's campaign, when known */
  product: string | null;
}

const isWord = (ch: string | undefined) => !!ch && /[\p{L}\p{N}]/u.test(ch);

/** `needle` appears in `hay` as a whole token: «V21» is not found in «V215», «V215» is found in «SY|TRF01|V215_H2». */
export function containsToken(hay: string, needle: string): boolean {
  const h = hay.toLowerCase();
  const n = needle.trim().toLowerCase();
  if (n.length < 2) return false;
  for (let from = 0; ; ) {
    const i = h.indexOf(n, from);
    if (i < 0) return false;
    if (!isWord(h[i - 1]) && !isWord(h[i + n.length])) return true;
    from = i + 1;
  }
}

/**
 * Which ads belong to which video. An ad belongs to ONE video (its spend is never counted twice):
 *   1. the video's CR code is the ad's creative code (an ad our own wizard named), else
 *   2. the video's V name is a whole token of the ad's name — the longest V name wins.
 * A video of another product never claims the ad. An ad that matches nothing stays unclaimed.
 */
export function linkAds(videos: Pick<BankVideo, "key" | "product" | "crCode" | "vName">[], ads: AdRef[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const sorted = [...videos].sort((a, b) => a.key.localeCompare(b.key));
  for (const ad of ads) {
    let best: { key: string; score: number } | null = null;
    for (const v of sorted) {
      if (ad.product && v.product !== "—" && v.product !== ad.product) continue;
      const score = v.crCode && ad.creativeCode === v.crCode ? 10_000 : v.vName && containsToken(ad.name, v.vName) ? v.vName.length : 0;
      if (score > 0 && (!best || score > best.score)) best = { key: v.key, score };
    }
    if (best) out.set(best.key, [...(out.get(best.key) ?? []), ad.id]);
  }
  return out;
}

// ───────────────────────────── the tired signal ─────────────────────────────

export interface DayPoint {
  day: string;
  spend: number;
  orders: number;
}

export type FatigueState = "tired" | "ok" | "unknown" | "idle";
export interface Fatigue {
  state: FatigueState;
  /** how far the recent cost of a real order is above its average (0.45 = +45%); null when it cannot be said */
  rise: number | null;
  text: string;
}

/**
 * The tired signal of one video: the cost of a real order over the last 2 complete days against its own average over the 7
 * complete days before them. +30% or more is «تعب». Spending with no order at all counts as tired once the recent spend
 * is more than one order cost on the average. Fewer than 3 orders in the base is not an average (unknown); no spend
 * in the last 2 days means it is not running (idle). A day with no row is a day with nothing.
 */
export function fatigueOf(points: DayPoint[], today: string): Fatigue {
  const sum = (from: string, to: string) => {
    let spend = 0;
    let orders = 0;
    for (const p of points) {
      if (p.day >= from && p.day <= to) {
        spend += p.spend;
        orders += p.orders;
      }
    }
    return { spend, orders };
  };
  const recent = sum(addDays(today, -FATIGUE.recentDays), addDays(today, -1));
  const base = sum(addDays(today, -(FATIGUE.recentDays + FATIGUE.baseDays)), addDays(today, -(FATIGUE.recentDays + 1)));
  if (recent.spend <= 0) return { state: "idle", rise: null, text: "ما صرف بآخر يومين — مش شغّال هلأ" };
  if (base.orders < FATIGUE.minBaseOrders) return { state: "unknown", rise: null, text: `لسا ما في أساس يقارن عليه: ${FATIGUE.minBaseOrders} طلبات على الأقل بالـ ${FATIGUE.baseDays} أيام اللي قبل` };
  const baseCost = base.spend / base.orders;
  if (recent.orders === 0) {
    return recent.spend >= baseCost
      ? { state: "tired", rise: null, text: `صرف آخر يومين بلا ولا طلب — أكتر من تكلفة طلب كامل بمعدّله` }
      : { state: "ok", rise: null, text: "لسا ما كمّل تكلفة طلب بآخر يومين" };
  }
  const rise = recent.spend / recent.orders / baseCost - 1;
  const pct = Math.round(Math.abs(rise) * 100);
  if (rise >= FATIGUE.rise) return { state: "tired", rise: r2(rise), text: `تكلفة الطلب بآخر يومين +${pct}% عن معدّل الـ ${FATIGUE.baseDays} أيام اللي قبل` };
  return { state: "ok", rise: r2(rise), text: rise >= 0 ? `ثابت (+${pct}% بس عن معدّله)` : `أحسن من معدّله (−${pct}%)` };
}

// ───────────────────────────── who ranks ─────────────────────────────

export interface Rankable {
  key: string;
  /** the spend of the window (with the card fee); null when Meta sent nothing */
  spend: number | null;
  orders: number;
  costPerOrder: number | null;
}

/**
 * Winners are ranked by the cost of a REAL order, cheapest first, among the videos that spent at least `minSpend` and got
 * an order — a cheap order from a video that spent almost nothing is luck, not a winner. A video that spent but is not
 * there yet (below the minimum, or no order yet) is «لسا بيتقيّم»; one that did not spend at all is idle.
 */
export function rank<T extends Rankable>(rows: T[], minSpend: number | null): { ranked: T[]; learning: T[]; idle: T[] } {
  const ranked: T[] = [];
  const learning: T[] = [];
  const idle: T[] = [];
  for (const r of rows) {
    if (r.spend === null || r.spend <= 0) idle.push(r);
    else if (r.spend >= (minSpend ?? 0) && r.orders >= 1 && r.costPerOrder !== null) ranked.push(r);
    else learning.push(r);
  }
  ranked.sort((a, b) => a.costPerOrder! - b.costPerOrder! || b.orders - a.orders || a.key.localeCompare(b.key));
  learning.sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0) || a.key.localeCompare(b.key));
  idle.sort((a, b) => a.key.localeCompare(b.key));
  return { ranked, learning, idle };
}

/** The minimum spend before a video is ranked: what the owner typed, else twice the cost he aims for per order, else none. */
export function minSpendOf(typed: number | null, tOrder: number | null): { value: number | null; from: "typed" | "target" | null } {
  if (typed !== null && typed > 0) return { value: typed, from: "typed" };
  if (tOrder !== null && tOrder > 0) return { value: r2(2 * tOrder), from: "target" };
  return { value: null, from: null };
}

// ───────────────────────────── drive links ─────────────────────────────

const DRIVE_ID = /^[A-Za-z0-9_-]{6,120}$/;
/** A Drive file id, or null — only the closed alphabet of an id ever reaches an address on the page. */
export const driveId = (v: string | null | undefined): string | null => (v && DRIVE_ID.test(v.trim()) ? v.trim() : null);
export const drivePreviewUrl = (id: string) => `https://drive.google.com/file/d/${id}/preview`;
export const driveViewUrl = (id: string) => `https://drive.google.com/file/d/${id}/view`;

// ───────────────────────────── the request to Hermes ─────────────────────────────

export const REQUEST_KINDS = ["new_hooks", "new_script", "to_test", "tired"] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];
/** The four buttons of a card. */
export const REQUEST_KIND_AR: Record<RequestKind, string> = { new_hooks: "بدو هوكات جديدة", new_script: "بدو سيناريو جديد", to_test: "ارفعه للتيست", tired: "تعب" };

export const REQUEST_STATUSES = ["asked", "with_hermes", "ready", "uploaded", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];
export const REQUEST_STATUS_AR: Record<RequestStatus, string> = { asked: "طلب", with_hermes: "عند هيرمز", ready: "جاهز", uploaded: "مرفوع", cancelled: "انلغى" };
/** The four steps the strip on a request shows, in order. */
export const REQUEST_STEPS = ["asked", "with_hermes", "ready", "uploaded"] as const;

const MOVES: Record<RequestStatus, readonly RequestStatus[]> = {
  asked: ["with_hermes", "ready", "cancelled"],
  // back to asked = given back to the queue
  with_hermes: ["asked", "ready", "cancelled"],
  // back to Hermes = sent back for another go
  ready: ["with_hermes", "uploaded", "cancelled"],
  uploaded: [],
  cancelled: [],
};
export const canMoveRequest = (from: RequestStatus, to: RequestStatus): boolean => MOVES[from].includes(to);
export const isOpenRequest = (s: RequestStatus): boolean => s !== "uploaded" && s !== "cancelled";

/** What the request looks like on المهام: the column it sits in follows the step it is at. */
export function taskStatusOf(s: RequestStatus): "new" | "doing" | "waiting_approval" | "done" {
  return s === "asked" ? "new" : s === "with_hermes" ? "doing" : s === "ready" ? "waiting_approval" : "done";
}

/** «V215 · JOB 345» — or its CR code — how the owner calls the video. */
export function videoLabel(v: { vName: string | null; job: string | null; crCode: string | null }): string {
  if (v.vName) return v.job ? `${v.vName} · JOB ${v.job}` : v.vName;
  return v.crCode ?? v.job ?? "فيديو";
}

export function requestTitle(kind: RequestKind, v: { vName: string | null; job: string | null; crCode: string | null }): string {
  const who = videoLabel(v);
  switch (kind) {
    case "new_hooks":
      return `هوكات جديدة على ${who}`;
    case "new_script":
      return `سيناريو جديد عن ${who}`;
    case "to_test":
      return `ارفعوا ${who} للتيست`;
    case "tired":
      return `${who} تعب — بدّلوه`;
  }
}

/** What the video has done, as the code computed it when the request was made (never typed by a person, never a customer's). */
export interface RequestNumbers {
  days: number | null;
  spend: number | null;
  orders: number;
  costPerOrder: number | null;
  hook: number | null;
  hold: number | null;
  ctr: number | null;
  fatigue: FatigueState;
  fatigueRise: number | null;
}

export interface RequestPayload {
  id: string;
  kind: RequestKind;
  kindLabel: string;
  product: string;
  job: string | null;
  vName: string | null;
  crCode: string | null;
  video: { driveFileId: string | null; url: string | null };
  scenario: { driveFileId: string | null; url: string | null };
  numbers: RequestNumbers;
  note: string | null;
  askedAt: string;
  /** where Hermes answers (it can also poll GET /api/v1/video-requests) */
  reply: { claim: string; complete: string };
}

export function buildPayload(r: { id: string; kind: RequestKind; product: string; job: string | null; vName: string | null; crCode: string | null; driveFileId: string | null; scenarioFileId: string | null; numbers: RequestNumbers; note: string | null; askedAt: string }, baseUrl: string): RequestPayload {
  const drive = driveId(r.driveFileId);
  const scenario = driveId(r.scenarioFileId);
  const base = baseUrl.replace(/\/+$/, "");
  return {
    id: r.id,
    kind: r.kind,
    kindLabel: REQUEST_KIND_AR[r.kind],
    product: r.product,
    job: r.job,
    vName: r.vName,
    crCode: r.crCode,
    video: { driveFileId: drive, url: drive ? driveViewUrl(drive) : null },
    scenario: { driveFileId: scenario, url: scenario ? driveViewUrl(scenario) : null },
    numbers: r.numbers,
    note: r.note,
    askedAt: r.askedAt,
    reply: { claim: `${base}/api/v1/video-requests/${r.id}/claim`, complete: `${base}/api/v1/video-requests/${r.id}/complete` },
  };
}

const num = (n: number | null, unit = "") => (n === null ? "—" : `${r1(n)}${unit}`);

/** The same request as a message for a chat — plain lines, no customer data, links only to Drive and to the app. */
export function requestText(p: RequestPayload): string {
  const n = p.numbers;
  const lines = [
    `🎬 ${p.kindLabel}`,
    `المنتج: ${p.product} · الفيديو: ${videoLabel(p)}`,
    p.video.url ? `الفيديو: ${p.video.url}` : null,
    p.scenario.url ? `السيناريو: ${p.scenario.url}` : "السيناريو: ما انربط ملفه لسا",
    n.spend === null ? "الأرقام (آخر 7 أيام): ما في أرقام لسا" : `الأرقام (آخر 7 أيام): تكلفة الطلب ${num(n.costPerOrder, "$")} · طلبات ${n.orders} · صرف ${num(n.spend, "$")} · Hook ${num(n.hook, "%")} · Hold ${num(n.hold, "%")} · CTR ${num(n.ctr, "%")}`,
    n.fatigue === "tired" ? "تنبيه: الفيديو تعبان (تكلفة الطلب طلعت 30% أو أكتر عن معدّله)" : null,
    p.note ? `ملاحظة: ${p.note}` : null,
    `رقم الطلب: ${p.id}`,
  ];
  return lines.filter((l): l is string => !!l).join("\n");
}
