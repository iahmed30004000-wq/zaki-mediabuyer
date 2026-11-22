/**
 * «شو عملنا»: THE MARKS ON THE BIG CHART (v6 · P6, docs/rebuild-v6/04-numbers.md §5) — pure. The chart answers «the number moved — but why?» by putting what we did beside it: numbered circles over the
 * line and the same numbers in a list under it. Every sentence is written here from a fact a table holds; the chart NEVER says «this caused that» — it puts the event next to the number and the judgement
 * is the owner's. A dry-run change is not an event (it changed nothing on Meta), and the chart carries six marks at most (the days with the most happening); the rest are in the list.
 */
import { agoWords } from "./bell";
import { inboxHref } from "./inbox";

/** Cut a sentence at `n` characters with «…». */
const cutText = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, Math.max(1, n - 1)).trimEnd()}…`);

export type ChartEventKind = "scale" | "pause" | "videos" | "order" | "launch";

export interface ChartEvent {
  /** the Amman day (YYYY-MM-DD) */
  day: string;
  /** one sentence, written by the code */
  text: string;
  /** where the event lives (the decision, the run, the order), or null */
  href: string | null;
  kind: ChartEventKind;
}

/** The chart carries this many numbered circles at most. */
export const MAX_MARKS = 6;
/** A product's new videos are one event only from this many in a day (a couple of files is not news). */
export const VIDEOS_MIN = 5;

const plural = (n: number, one: string, two: string, few: string, many: string): string => (n === 1 ? one : n === 2 ? two : n < 11 ? `${n} ${few}` : `${n} ${many}`);

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0);

/** «جولة الليل: كبّرت 2 ووقّفت 3» from what the round logged (`scaled`, `paused`, `ads_paused`); nothing scaled or stopped is no event. */
export function nightRoundEvent(run: { id: string; day: string; jobKey: string; metrics: unknown }): ChartEvent | null {
  const m = (run.metrics && typeof run.metrics === "object" ? run.metrics : {}) as Record<string, unknown>;
  const scaled = num(m.scaled);
  const stopped = num(m.paused) + num(m.ads_paused);
  if (!scaled && !stopped) return null;
  const parts = [scaled ? `كبّرت ${scaled}` : null, stopped ? `وقّفت ${stopped}` : null].filter(Boolean);
  return { day: run.day, text: `جولة الليل: ${parts.join(" و")}`, href: `/tasks/${encodeURIComponent(run.jobKey)}/runs/${encodeURIComponent(run.id)}`, kind: "scale" };
}

/** What the kind of a change is, for the chart. A kind with no place on the chart (connecting an asset, an audience) is not drawn. */
const KIND_OF: Record<string, ChartEventKind> = { raise_step: "scale", above_cap: "scale", safety_pause: "pause", safety_reduce: "pause", safety_net: "pause", new_ad: "launch", test_campaign: "launch" };

/**
 * A change that really reached Meta, in the words the change itself carries. Only an EXECUTED change in LIVE mode is an event: a trial (`dry_run`) changed nothing, so the chart never marks it.
 * Launches are read here too — a launch request's `changeSetId` is this very change.
 */
export function changeEvent(c: { id: string; kind: string; sentence: string; writeMode: string; state: string; day: string }): ChartEvent | null {
  if (c.writeMode !== "live" || c.state !== "executed") return null;
  const kind = KIND_OF[c.kind];
  if (!kind || !c.sentence.trim()) return null;
  return { day: c.day, text: cutText(c.sentence.trim(), 90), href: inboxHref(`change:${c.id}`), kind };
}

/** «نزل 12 فيديو جديد على «حرير»» — per product and day, from `VIDEOS_MIN` videos. `nameOf` gives the Arabic name. */
export function videoEvents(items: readonly { productCode: string; day: string }[], nameOf: (code: string) => string): ChartEvent[] {
  const count = new Map<string, { code: string; day: string; n: number }>();
  for (const i of items) {
    const k = `${i.productCode}|${i.day}`;
    const cur = count.get(k) ?? { code: i.productCode, day: i.day, n: 0 };
    cur.n++;
    count.set(k, cur);
  }
  return [...count.values()]
    .filter((c) => c.n >= VIDEOS_MIN)
    .map((c) => ({ day: c.day, text: `نزل ${plural(c.n, "فيديو جديد", "فيديوهين جداد", "فيديوهات جديدة", "فيديو جديد")} على «${nameOf(c.code)}»`, href: "/ads/videos", kind: "videos" as const }));
}

/** A standing order that began or ended inside the window: «أمر: ولا فيديو جديد» · «رجع: ولا فيديو جديد». The owner's own words, cut short. */
export function orderEvents(orders: readonly { id: string; text: string; startsDay: string; endedDay: string | null; status: string }[], from: string, to: string): ChartEvent[] {
  const out: ChartEvent[] = [];
  for (const o of orders) {
    if (o.status === "pending" || o.status === "rejected" || !o.text.trim()) continue;
    const text = cutText(o.text.trim(), 70);
    if (o.startsDay >= from && o.startsDay <= to) out.push({ day: o.startsDay, text: `أمر: ${text}`, href: "/tasks", kind: "order" });
    if (o.endedDay && o.endedDay >= from && o.endedDay <= to) out.push({ day: o.endedDay, text: `رجع: ${text}`, href: "/tasks", kind: "order" });
  }
  return out;
}

export interface ChartMark {
  day: string;
  /** one sentence for the circle's list: when a day holds several events they are joined */
  text: string;
  /** the link of the day's first event */
  href: string | null;
  events: ChartEvent[];
}

/**
 * Six marks at most. A mark is a DAY: the days with the most events win (a tie goes to the more recent day), and the chosen ones are numbered oldest first — the way the chart reads. The events of the
 * days that did not get a mark are the list under the chart, newest first. Nothing is dropped: every event is in the marks or in the rest.
 */
export function splitMarks(events: readonly ChartEvent[], max = MAX_MARKS): { marks: ChartMark[]; rest: ChartEvent[] } {
  const days = new Map<string, ChartEvent[]>();
  for (const e of events) days.set(e.day, [...(days.get(e.day) ?? []), e]);
  const chosen = [...days.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? 1 : -1)).slice(0, Math.max(0, max));
  const marked = new Set(chosen.map(([d]) => d));
  const marks = chosen
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, list]) => ({ day, text: list.map((e) => e.text).join(" · "), href: list.find((e) => e.href)?.href ?? null, events: list }));
  const rest = events.filter((e) => !marked.has(e.day)).sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  return { marks, rest };
}

/** «قبل يومين» for a day written YYYY-MM-DD, counted from `today` (an Amman date): the list says how long ago it was. */
export function dayAgoWords(day: string, today: string): string {
  const d = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000);
  // eleven days and more are written «قبل 12 يوم» (the singular after a number from eleven)
  return d <= 0 ? "اليوم" : d >= 11 ? `قبل ${d} يوم` : agoWords(d * 24 * 60);
}
