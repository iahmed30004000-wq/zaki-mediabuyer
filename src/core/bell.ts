/**
 * THE BELL (v6 · P3, docs/rebuild-v6/02-screens.md §7): the last 30 notices of the person, each with a lamp, a title, a time and a link, and the number of the ones not read.
 * Pure: the rows come from the `Notification` table; the clock is a parameter. A notice's link is only ever an address inside the site.
 */
import type { Lamp } from "./run-state";

export const BELL_LIMIT = 30;

export interface BellRow {
  id: string;
  urgency: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: Date;
  readAt: Date | null;
}

export interface BellItem {
  id: string;
  /** red = it stopped · orange = it needs you · yellow = for your information */
  lamp: Lamp;
  title: string;
  body: string | null;
  /** an address of the site, or null */
  href: string | null;
  /** «قبل 5 دقايق» */
  when: string;
  at: string;
  unread: boolean;
}

/** The lamp of a notice: red is a stop, orange asks something of him, the rest is only news. */
export const lampOfUrgency = (u: string): Lamp => (u === "red" ? "fail" : u === "orange" ? "wait" : "off");

/** A link to a place on the site (one slash at the start, no scheme, no second slash): anything else is dropped — a notice never takes the owner to another site. */
export function safeInternalHref(href: string | null | undefined): string | null {
  const h = (href ?? "").trim();
  if (!h.startsWith("/") || h.startsWith("//") || h.includes("\\") || /[\u0000-\u001f]/.test(h)) return null;
  return h.slice(0, 300);
}

/** «قبل 5 دقايق» · «قبل ساعتين» · «قبل 3 أيام». */
export function agoWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 1) return "هلق";
  if (m < 60) return m === 1 ? "قبل دقيقة" : m === 2 ? "قبل دقيقتين" : m < 11 ? `قبل ${m} دقايق` : `قبل ${m} دقيقة`;
  const h = Math.round(m / 60);
  if (h < 24) return h === 1 ? "قبل ساعة" : h === 2 ? "قبل ساعتين" : h < 11 ? `قبل ${h} ساعات` : `قبل ${h} ساعة`;
  const d = Math.round(h / 24);
  return d === 1 ? "قبل يوم" : d === 2 ? "قبل يومين" : `قبل ${d} أيام`;
}

export function bellItem(r: BellRow, now: Date): BellItem {
  return {
    id: r.id,
    lamp: lampOfUrgency(r.urgency),
    title: r.title,
    body: r.body,
    href: safeInternalHref(r.href),
    when: agoWords((now.getTime() - r.createdAt.getTime()) / 60_000),
    at: r.createdAt.toISOString(),
    unread: r.readAt === null,
  };
}

/** The notices as the panel shows them: the newest first, 30 at most. */
export function bellItems(rows: readonly BellRow[], now: Date): BellItem[] {
  return [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, BELL_LIMIT).map((r) => bellItem(r, now));
}
