/**
 * «الفيديوهات» as the screen reads it (v3 · D): per product, the bank against 50, the videos ranked by the cost of a real
 * order, the tired ones, the ones that are not running, and the requests that wait on Hermes. The arithmetic is
 * src/core/video-board.ts (and the same calculator the ads table uses, `viewOf` + `metricsOf`, so a video's numbers are
 * the numbers of its ads added up — never a second way of counting); this file gathers: the database (MOCK_MODE=0) or
 * the demo set, run through the very same code.
 *
 * A screen is real or it is demo — never both. Nothing here edits a video or classifies one for policy (owner rule).
 */
import { addDays, ammanKey, eachDay, parseRange } from "@/core/dates";
import { daysRunning, earliest, indexFacts, metricsOf, type Counted, type CountsLike, type Node, type Window } from "@/core/ads-table";
import { parseAdName } from "@/core/naming";
import { costTone } from "@/core/numbers";
import { breakevenOf, readRules } from "@/core/rules-v2";
import {
  RANK_DAYS,
  REQUEST_KIND_AR,
  REQUEST_STATUS_AR,
  VIDEO_STATE_AR,
  bankSummary,
  drivePreviewUrl,
  driveViewUrl,
  driveId,
  fatigueOf,
  isOpenRequest,
  linkAds,
  mergeBank,
  minSpendOf,
  rank,
  videoLabel,
  type AdRef,
  type AssetIn,
  type BankItemIn,
  type BankSummary,
  type BankVideo,
  type DayPoint,
  type Fatigue,
  type RequestKind,
  type RequestNumbers,
  type RequestStatus,
  type VideoState,
} from "@/core/video-board";
import { hermesChatFromEnv, hermesFromEnv } from "@/adapters/hermes";
import { CREATIVES, targetsOf, viewOf, type Counts } from "@/lib/mock/data";
import { demoSource, realSource, type Source } from "@/lib/ads-table";
import { db } from "@/server/db";
import { getSetting } from "@/server/settings";
import { forViewer } from "@/server/redact";

// ───────────────────────────── what a screen reads ─────────────────────────────

export interface BoardRequest {
  id: string;
  videoKey: string;
  productCode: string;
  label: string;
  kind: RequestKind;
  kindLabel: string;
  status: RequestStatus;
  statusLabel: string;
  via: "api" | "telegram" | "none";
  createdAt: string;
  deliveryError: string | null;
  resultNote: string | null;
}

export interface BoardVideo {
  key: string;
  product: string;
  label: string;
  job: string | null;
  vName: string | null;
  crCode: string | null;
  status: VideoState;
  statusLabel: string;
  /** the Drive preview to embed (only a real file id ever gets here) and the page to open it in */
  previewUrl: string | null;
  videoUrl: string | null;
  scenarioUrl: string | null;
  adsCount: number;
  /** days since its first ad started; null when none of its ads says */
  days: number | null;
  /** the last 7 days (today included), with the card's fee — the same numbers the ads table shows */
  spend: number | null;
  orders: number;
  costPerOrder: number | null;
  hook: number | null;
  hold: number | null;
  ctr: number | null;
  tone: "ok" | "warn" | "danger" | null;
  fatigue: Fatigue;
  /** the request still open on it (the latest) */
  request: BoardRequest | null;
  notes: string | null;
}

export interface BoardProduct {
  code: string;
  name: string;
  bank: BankSummary;
  /** the least spend before a video is ranked, and where it came from */
  minSpend: number | null;
  minSpendFrom: "typed" | "target" | null;
  breakeven: number | null;
  winners: BoardVideo[];
  /** spent, but not ranked yet: below the minimum, or no order yet */
  learning: BoardVideo[];
  /** not running now: the bank's own videos waiting their turn */
  rest: BoardVideo[];
  tiredCount: number;
  requests: BoardRequest[];
}

export interface BoardData {
  demo: boolean;
  today: string;
  /** the owner's target cost of a real order (null until he types it) */
  target: number | null;
  /** what the owner typed for the minimum spend (null = not typed) */
  typedMinSpend: number | null;
  hermes: { api: boolean; chat: boolean };
  products: BoardProduct[];
  totals: { videos: number; winners: number; tired: number; openRequests: number };
}

export interface RequestRowIn {
  id: string;
  videoKey: string;
  productCode: string;
  kind: string;
  status: string;
  via: string;
  job: string | null;
  vName: string | null;
  crCode: string | null;
  createdAt: Date;
  deliveryError: string | null;
  resultNote: string | null;
}

export interface BoardCtx {
  target: number | null;
  typedMinSpend: number | null;
  breakeven: (productCode: string | null) => number | null;
  hermes: { api: boolean; chat: boolean };
}

// ───────────────────────────── assembling ─────────────────────────────

const r2 = (n: number) => Math.round(n * 100) / 100;

const asRequest = (r: RequestRowIn): BoardRequest => ({
  id: r.id,
  videoKey: r.videoKey,
  productCode: r.productCode,
  label: videoLabel(r),
  kind: r.kind as RequestKind,
  kindLabel: REQUEST_KIND_AR[r.kind as RequestKind] ?? r.kind,
  status: r.status as RequestStatus,
  statusLabel: REQUEST_STATUS_AR[r.status as RequestStatus] ?? r.status,
  via: r.via === "api" || r.via === "telegram" ? r.via : "none",
  createdAt: r.createdAt.toISOString(),
  deliveryError: r.deliveryError,
  resultNote: r.resultNote,
});

/** Several ads' counts as one (a video that runs in more than one ad). */
function sumCounted(list: Counted[]): Counted {
  const counts: CountsLike = { spend: 0, impressions: 0, clicks: 0, v3s: 0, thru: 0, purchases: 0, orders: 0, mature: 0, confirmed: 0, shipments: 0, delivered: 0, returned: 0 };
  let conversations: number | undefined;
  for (const c of list) {
    const k = c.counts;
    counts.spend += k.spend;
    counts.impressions += k.impressions;
    counts.clicks += k.clicks;
    counts.v3s += k.v3s;
    counts.thru += k.thru;
    counts.purchases += k.purchases;
    counts.orders += k.orders;
    counts.mature += k.mature;
    counts.confirmed += k.confirmed;
    counts.shipments += k.shipments;
    counts.delivered += k.delivered;
    counts.returned += k.returned;
    if (k.conversations !== undefined) conversations = (conversations ?? 0) + k.conversations;
  }
  if (conversations !== undefined) counts.conversations = conversations;
  return { counts, frequency: null, hasInsights: list.some((c) => c.hasInsights), has: list.some((c) => c.has) };
}

const REST_ORDER: Record<VideoState, number> = { ready: 0, bank: 1, requested: 2, uploaded: 3, testing: 4, winner: 5, fatigued: 6, dropped: 7 };

/** Turns the facts into the board. No database here — `loadBoard` fetches, this computes (and is tested on its own). */
export function assembleBoard(src: Source, bank: BankVideo[], requests: RequestRowIn[], now: Date, ctx: BoardCtx): BoardData {
  const today = ammanKey(now);
  const W7: Window = { from: addDays(today, -(RANK_DAYS - 1)), to: today };
  const products = new Map(src.products.map((p) => [p.code, p]));

  const roots: Node[] = src.campaigns.map((c) => ({ id: c.id, level: "campaign", children: c.adsets.map((s) => ({ id: s.id, level: "adset", children: s.ads.map((a) => ({ id: a.id, level: "ad", children: [] })) })) }));
  const facts = indexFacts(roots, src.insights, src.orders, now.getTime());

  const adRefs: AdRef[] = [];
  const startOf = new Map<string, string | null>();
  for (const c of src.campaigns) {
    for (const s of c.adsets) {
      for (const a of s.ads) {
        adRefs.push({ id: a.id, name: a.name, creativeCode: parseAdName(a.name)?.creativeCode ?? null, product: c.productCode });
        startOf.set(a.id, a.start ?? s.start ?? c.start);
      }
    }
  }
  const links = linkAds(bank, adRefs);
  const open = requests.filter((r) => isOpenRequest(r.status as RequestStatus));
  const openOf = new Map<string, BoardRequest>();
  for (const r of [...open].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) openOf.set(r.videoKey, asRequest(r));
  const seriesDays = eachDay(addDays(today, -(7 + 2)), addDays(today, -1));

  const measure = (v: BankVideo): BoardVideo => {
    const adIds = links.get(v.key) ?? [];
    const p = products.get(v.product);
    const margin = p ? targetsOf(p).margin : null;
    const sum = sumCounted(adIds.map((id) => facts.counted("ad", id, W7)));
    const view = viewOf(sum.counts as Counts, p);
    const m = metricsOf(sum, view, margin);
    const series: DayPoint[] = seriesDays.map((day) => {
      const d = sumCounted(adIds.map((id) => facts.counted("ad", id, { from: day, to: day })));
      return { day, spend: d.counts.spend, orders: d.counts.orders };
    });
    const drive = driveId(v.driveFileId);
    const scenario = driveId(v.scenarioFileId);
    const ranBefore = sum.has;
    return {
      key: v.key,
      product: v.product,
      label: videoLabel(v),
      job: v.job,
      vName: v.vName,
      crCode: v.crCode,
      status: v.status,
      statusLabel: VIDEO_STATE_AR[v.status],
      previewUrl: drive ? drivePreviewUrl(drive) : null,
      videoUrl: drive ? driveViewUrl(drive) : null,
      scenarioUrl: scenario ? driveViewUrl(scenario) : null,
      adsCount: adIds.length,
      days: daysRunning(earliest(adIds.map((id) => startOf.get(id))), today),
      spend: ranBefore ? m.spend : null,
      orders: m.orders ?? 0,
      costPerOrder: m.costPerOrder,
      hook: m.hook,
      hold: m.hold,
      ctr: m.ctr,
      tone: costTone(m.costPerOrder, ctx.target, ctx.breakeven(v.product)) ?? null,
      fatigue: fatigueOf(series, today),
      request: openOf.get(v.key) ?? null,
      notes: v.notes,
    };
  };

  const codes = new Set<string>([...bank.map((v) => v.product), ...src.campaigns.map((c) => c.productCode).filter((c): c is string => !!c)]);
  codes.delete("—");
  const out: BoardProduct[] = [];
  for (const code of codes) {
    const p = products.get(code);
    const mine = bank.filter((v) => v.product === code);
    const measured = mine.map(measure);
    const min = minSpendOf(ctx.typedMinSpend, p ? targetsOf(p).tOrder : null);
    const { ranked, learning, idle } = rank(measured, min.value);
    const rest = idle.filter((v) => v.status !== "dropped").sort((a, b) => REST_ORDER[a.status] - REST_ORDER[b.status] || a.key.localeCompare(b.key));
    out.push({
      code,
      name: p?.name ?? code,
      bank: bankSummary(mine),
      minSpend: min.value,
      minSpendFrom: min.from,
      breakeven: ctx.breakeven(code),
      winners: ranked,
      learning,
      rest,
      tiredCount: [...ranked, ...learning].filter((v) => v.fatigue.state === "tired").length,
      requests: open.filter((r) => r.productCode === code).map(asRequest),
    });
  }
  out.sort((a, b) => b.winners.length + b.learning.length - (a.winners.length + a.learning.length) || b.bank.count - a.bank.count || a.name.localeCompare(b.name));

  return {
    demo: src.demo,
    today,
    target: ctx.target,
    typedMinSpend: ctx.typedMinSpend,
    hermes: ctx.hermes,
    products: out,
    totals: {
      videos: out.reduce((n, p) => n + p.bank.count, 0),
      winners: out.reduce((n, p) => n + p.winners.length, 0),
      tired: out.reduce((n, p) => n + p.tiredCount, 0),
      openRequests: open.length,
    },
  };
}

// ───────────────────────────── where the facts come from ─────────────────────────────

/** The demo's videos: the demo registry's, tied to the demo ads by their CR codes. */
function demoBank(): BankVideo[] {
  const state = { inbox: "bank", review: "bank", ready: "ready", live: "testing", fatigued: "fatigued", excluded: "dropped" } as const;
  return CREATIVES.filter((c) => c.code.startsWith("CR") && c.stage !== "excluded").map((c) => ({
    key: c.code,
    product: c.product,
    job: null,
    vName: null,
    crCode: c.code,
    driveFileId: null,
    scenarioFileId: null,
    metaVideoId: null,
    status: state[c.stage],
    notes: null,
  }));
}

async function loadBank(): Promise<BankVideo[]> {
  const [items, assets] = await Promise.all([
    db.videoBankItem.findMany({ select: { job: true, vName: true, productCode: true, driveFileId: true, metaVideoId: true, scenarioFileId: true, status: true, notes: true } }),
    db.creativeAsset.findMany({ select: { crCode: true, productCode: true, driveFileId: true, metaVideoId: true, status: true, dupOf: true, notes: true } }),
  ]);
  const a: BankItemIn[] = items;
  const b: AssetIn[] = assets;
  return mergeBank(a, b);
}

async function loadOpenRequests(): Promise<RequestRowIn[]> {
  return db.videoRequest.findMany({
    where: { status: { in: ["asked", "with_hermes", "ready"] } },
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, videoKey: true, productCode: true, kind: true, status: true, via: true, job: true, vName: true, crCode: true, createdAt: true, deliveryError: true, resultNote: true },
  });
}

async function loadBoardRaw(now = new Date()): Promise<BoardData> {
  const today = ammanKey(now);
  const demo = process.env.MOCK_MODE === "1";
  const rules = readRules(await getSetting("campaign.rules"));
  const typedMinSpend = await getSetting("videos.min_spend");
  const range = parseRange({ d: "7d" }, now);
  const [src, bank, requests] = demo ? [demoSource(today, now.getTime()), demoBank(), [] as RequestRowIn[]] : await Promise.all([realSource(range, today), loadBank(), loadOpenRequests()]);
  return assembleBoard(src, bank, requests, now, {
    target: demo ? 3 : rules.targetCost,
    typedMinSpend: typeof typedMinSpend === "number" && typedMinSpend > 0 ? typedMinSpend : null,
    breakeven: (code) => (demo ? (code === "TRF01" ? 4.5 : code === "TIN01" ? 6 : null) : breakevenOf(rules, code)),
    hermes: { api: hermesFromEnv() !== null, chat: hermesChatFromEnv() !== null },
  });
}

/** One video of the board by its key (what a request is made about), or null. */
async function findBoardVideoRaw(key: string, now = new Date()): Promise<BoardVideo | null> {
  const board = await loadBoard(now);
  for (const p of board.products) for (const v of [...p.winners, ...p.learning, ...p.rest]) if (v.key === key) return v;
  return null;
}

/** What a request carries about its video: only the numbers the code computed. */
export function numbersOf(v: BoardVideo): RequestNumbers {
  return { days: v.days, spend: v.spend === null ? null : r2(v.spend), orders: v.orders, costPerOrder: v.costPerOrder, hook: v.hook, hold: v.hold, ctr: v.ctr, fatigue: v.fatigue.state, fatigueRise: v.fatigue.rise };
}

/** loadBoard for a screen: without `money.view` no profit, margin, product cost or break-even leaves the server (docs/rebuild/05-permissions.md §3). */
export const loadBoard = async (...a: Parameters<typeof loadBoardRaw>) => forViewer(await loadBoardRaw(...a));

/** findBoardVideo for a screen: without `money.view` no profit, margin, product cost or break-even leaves the server (docs/rebuild/05-permissions.md §3). */
export const findBoardVideo = async (...a: Parameters<typeof findBoardVideoRaw>) => forViewer(await findBoardVideoRaw(...a));
