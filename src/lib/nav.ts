/**
 * THE MAP (v6 · P8, docs/rebuild-v6/02-screens.md §1) — the only one. Four places and the settings:
 *   الرئيسية   «شو صاير هلق، وشو بدّه مني؟»              /
 *   المهام     «مين عم يشتغل شو، ووين وصل؟»              هلق · جدول اليوم · كل المهام · النتائج
 *   الأرقام    «وين كنا، وكيف صرنا؟»                      الخلاصة · المنتجات · التأكيد والشحن · المخزون
 *   الإعلانات  «الحملات والفيديوهات»
 *   الإعدادات  مرة وبتنتسى
 *
 * «بانتظارك» is not a place: the decisions are the first part of the home and `/inbox` opens from «كل القرارات». «التشغيل» is not a place either: it is a tab of «الأرقام».
 * One question per place; nothing lives in two places; two levels of navigation at most (a place, then a tab). The v5 addresses still open: next.config.mjs redirects them
 * (`LEGACY_REDIRECTS`; tests/nav.test.ts holds the table and tests/old-routes.test.ts keeps the code from linking to them).
 */
import type { LucideIcon } from "lucide-react";
import { Gauge, Home, ListChecks, Megaphone, Settings } from "lucide-react";
import type { PlaceId } from "@/core/roles";

/** The four places. */
export type PlaceKey = "home" | "tasks" | "numbers" | "ads";

export interface PlaceTab {
  /** The address of the tab; a `?query` part is matched too. */
  href: string;
  label: string;
}

export interface Place {
  key: PlaceKey;
  href: string;
  /** The name in the side menu and the bottom bar. */
  label: string;
  /** The title on the page header. */
  title: string;
  /** The one question the place answers (shown under the title). */
  question: string;
  icon: LucideIcon;
  /** Four at most; the first is the short answer (03 §7). */
  tabs: readonly PlaceTab[];
  /** The place of a role's bar it belongs to (`ROLE_PLACES`). */
  role?: PlaceId;
  /** A place that is the ads' AND the operations' («الأرقام»): a role that has any one of these in its bar is given it. Used instead of `role`. */
  roles?: readonly PlaceId[];
}

export const PLACES: readonly Place[] = [
  { key: "home", href: "/", label: "الرئيسية", title: "الرئيسية", question: "شو صاير هلق، وشو بدّه مني؟", icon: Home, tabs: [], role: "home" },
  {
    key: "tasks",
    href: "/tasks",
    label: "المهام",
    title: "المهام",
    question: "مين عم يشتغل شو، ووين وصل؟",
    icon: ListChecks,
    tabs: [
      { href: "/tasks", label: "هلق" },
      { href: "/tasks/day", label: "جدول اليوم" },
      { href: "/tasks/all", label: "كل المهام" },
      { href: "/tasks/results", label: "النتائج" },
    ],
    role: "work",
  },
  {
    key: "numbers",
    href: "/numbers",
    label: "الأرقام",
    title: "الأرقام",
    question: "وين كنا، وكيف صرنا؟",
    icon: Gauge,
    tabs: [
      { href: "/numbers", label: "الخلاصة" },
      { href: "/numbers/products", label: "المنتجات" },
      { href: "/numbers/ops", label: "التأكيد والشحن" },
      { href: "/numbers/stock", label: "المخزون" },
    ],
    roles: ["ads", "ops"],
  },
  {
    key: "ads",
    href: "/ads",
    label: "الإعلانات",
    title: "الإعلانات",
    question: "الحملات والفيديوهات",
    icon: Megaphone,
    // «صحة البيانات» and «سلّم التكبير» are not tabs: they open from two links above the campaigns table
    tabs: [
      { href: "/ads", label: "الحملات" },
      { href: "/ads/videos", label: "الفيديوهات" },
      { href: "/ads/tests", label: "الاختبارات" },
    ],
    role: "ads",
  },
];

/** The tabs of the decisions list (`/inbox`): it is under no place, it opens from the home. */
export const INBOX_TABS: readonly PlaceTab[] = [
  { href: "/inbox", label: "بدها قرارك" },
  { href: "/inbox/later", label: "مؤجّلة" },
  { href: "/inbox/done", label: "قررتها" },
];

/** The places a role's bar has. */
export function placesFor(roleBar: readonly string[]): Place[] {
  return PLACES.filter((p) => (p.roles ? p.roles.some((r) => roleBar.includes(r)) : roleBar.includes(p.role ?? p.key)));
}

/** The settings live under the side menu, not in the places. */
export const SETTINGS = { key: "settings" as const, href: "/settings", label: "الإعدادات", title: "الإعدادات", question: "الربط والفريق والقواعد — مرة وبتنتسى", icon: Settings };

/** What the page header shows: a place, the decisions list, or the settings. */
export interface Where {
  key: PlaceKey | "inbox" | "settings";
  label: string;
  title: string;
  question: string;
  href: string;
}

/** Screens that are under no place: the decisions list (it opens from the home) and the settings. */
const OTHER: readonly Where[] = [
  { key: "inbox", label: "بانتظارك", title: "بانتظارك", question: "شو بدّه قراري؟", href: "/inbox" },
  { key: "settings", label: SETTINGS.label, title: SETTINGS.title, question: SETTINGS.question, href: SETTINGS.href },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
const inPlace = (p: Place, pathname: string): boolean => p.href !== "/" && under(pathname, p.href);

/** The place (or the decisions, or the settings) of an address; anything unknown is the home. */
export function placeOf(pathname: string): Where {
  const hit = PLACES.find((p) => inPlace(p, pathname));
  if (hit) return { key: hit.key, label: hit.label, title: hit.title, question: hit.question, href: hit.href };
  const other = OTHER.find((o) => under(pathname, o.href));
  if (other) return other;
  const home = PLACES[0]!;
  return { key: home.key, label: home.label, title: home.title, question: home.question, href: home.href };
}

/** The tab of an address inside its place (the longest address that matches), or null for a place without tabs. */
export function tabOf(pathname: string): PlaceTab | null {
  const place = PLACES.find((p) => inPlace(p, pathname));
  if (!place) return null;
  const matching = place.tabs.filter((t) => pathname === t.href || (t.href !== place.href && pathname.startsWith(`${t.href}/`)));
  return matching.sort((a, b) => b.href.length - a.href.length)[0] ?? place.tabs[0] ?? null;
}
