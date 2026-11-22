/**
 * THE SAME LINE, SAID ONCE (v6 · P3, U-11). A day had 104 lines of «فيديو … انرفع لميتا» — one per video — and a list of runs that said the same thing twice; the owner read
 * a wall. Here lines that are the same thing become ONE line with a count that opens to show them: the videos by what became of them, any other lines that are word for word the
 * same. Pure: it reads the lines the day already wrote (`core/day.ts`) and changes no number.
 */
import type { DayItem } from "./day";

export interface CollapsedLine {
  /** stable within a day: `<kind>:<shape>` */
  key: string;
  /** the line as shown: «104 فيديو انرفعوا لميتا» or the single line itself */
  text: string;
  /** how many lines it stands for (1 = nothing was folded) */
  count: number;
  /** the lines folded (all of them, in time order) */
  items: DayItem[];
  /** the earliest of them */
  at: string;
  actor: string;
  kind: DayItem["kind"];
  tone?: DayItem["tone"];
  href?: string;
}

/** Fewer than this is read one by one (three videos are not a wall). */
export const COLLAPSE_FROM = 3;

/** What a video line says happened to it: the text after the last «): ». */
const videoOutcome = (text: string): string => {
  const at = text.lastIndexOf("): ");
  return at === -1 ? text : text.slice(at + 3).trim();
};

/** «انرفع لميتا» → «فيديو انرفعوا لميتا» — the plural sentence of a video outcome. */
const VIDEO_PLURAL: Record<string, string> = {
  "جاهز": "جاهزين",
  "انرفع لميتا": "انرفعوا لميتا",
  "شغّال": "شغّالين",
  "تعب": "تعبوا",
  "تجربة: ما انبعت لميتا": "تجربة: ما انبعتوا لميتا",
};

const videoLine = (n: number, outcome: string): string => `${n} فيديو ${VIDEO_PLURAL[outcome] ?? outcome}`;

/**
 * Folds the lines of a day. Videos with the same outcome become «N فيديو …» (from `min` of them); any other lines with exactly the same text (by the same doer and kind) become
 * the line with «× N». The order is the time of the first line of each fold; a line that stands alone stays as it was.
 */
export function collapseDayItems(items: readonly DayItem[], min = COLLAPSE_FROM): CollapsedLine[] {
  const sorted = [...items].sort((a, b) => a.at.localeCompare(b.at));
  const buckets = new Map<string, DayItem[]>();
  const order: string[] = [];
  for (const i of sorted) {
    const shape = i.kind === "video" ? `video:${i.actor}:${videoOutcome(i.text)}` : `${i.kind}:${i.actor}:${i.text}`;
    if (!buckets.has(shape)) {
      buckets.set(shape, []);
      order.push(shape);
    }
    buckets.get(shape)!.push(i);
  }
  const out: CollapsedLine[] = [];
  for (const shape of order) {
    const list = buckets.get(shape)!;
    const first = list[0]!;
    if (list.length < min) {
      // not enough to fold: every line stays as it was
      for (const i of list) out.push({ key: `${shape}#${i.at}`, text: i.text, count: 1, items: [i], at: i.at, actor: i.actor, kind: i.kind, ...(i.tone ? { tone: i.tone } : {}), ...(i.href ? { href: i.href } : {}) });
      continue;
    }
    const text = first.kind === "video" ? videoLine(list.length, videoOutcome(first.text)) : `${first.text} × ${list.length}`;
    out.push({ key: shape, text, count: list.length, items: list, at: first.at, actor: first.actor, kind: first.kind, ...(first.tone ? { tone: first.tone } : {}), ...(first.href ? { href: first.href } : {}) });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}
