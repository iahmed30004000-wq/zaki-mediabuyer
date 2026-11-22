/**
 * THE MAP — two of them while the new structure is a trial (v6 · P3, docs/rebuild-v6/02-screens.md §1). The cookie `mb_nav` says which one a person sees:
 * `v6` (the owner's default) or `old` (the button «ارجع للترتيب القديم» in the settings, until P8 removes it). A place whose screens are not built yet leads to its
 * old counterpart (`legacyHref`).
 *
 * v6 — four places and a «＋»:
 *   الرئيسية   «شو صاير هلق، وشو بدّه مني؟»              /
 *   المهام     «مين عم يشتغل شو، ووين وصل؟»              هلق · جدول اليوم · كل المهام · النتائج
 *   الأرقام    «وين كنا، وكيف صرنا؟»                      (P6 builds it; until then the operations screens)
 *   الإعلانات  «الحملات والفيديوهات»
 *   الإعدادات  مرة وبتنتسى
 *
 * old (v5) — five places: the home · بانتظارك · الشغل · الإعلانات · التشغيل. One question per place; nothing lives in two places; two levels of navigation at
 * most (a place, then a tab). Old addresses still work: next.config.mjs redirects them (tests/nav.test.ts holds the table).
 */
import type { LucideIcon } from "lucide-react";
import { Gauge, Home, Inbox, ListChecks, Megaphone, Settings, Truck, Workflow } from "lucide-react";
import type { PlaceId, RoleKey } from "@/core/roles";

/** The places of the old map (v5) and of the new one (v6). */
export type PlaceKey = "home" | "inbox" | "work" | "ads" | "ops" | "tasks" | "numbers";

export interface PlaceTab {
  /** The address of the tab; a `?query` part is matched too. */
  href: string;
  label: string;
  /** false until the phase that builds the screen: a tab with no screen is not shown. */
  ready?: boolean;
  /** Old addresses that are this tab until P8 moves them (`/ops/stock` is «المخزون»): the tab is lit there too. */
  also?: readonly string[];
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
  /** A place whose screens are not built yet leads to its old counterpart (`legacyHref`) — no «قريباً» screens. */
  ready: boolean;
  /** The place of a role's bar it belongs to (`ROLE_PLACES`); the old map's places are their own. */
  role?: PlaceId;
  /** A place that is the ads' AND the operations' («الأرقام»): a role that has any one of these in its bar is given it. Used instead of `role`. */
  roles?: readonly PlaceId[];
  /** Where the place leads while its own screens are not built. */
  legacyHref?: string;
  /** Other address prefixes that live inside this place (the v6 «المهام» holds the addresses of the old «الشغل» too). */
  under?: readonly string[];
}

export const PLACES: readonly Place[] = [
  { key: "home", href: "/", label: "الرئيسية", title: "الرئيسية", question: "شو بدّه مني، وكيف الوضع؟", icon: Home, tabs: [], ready: true },
  {
    key: "inbox",
    href: "/inbox",
    label: "بانتظارك",
    title: "بانتظارك",
    question: "شو بدّه قراري؟",
    icon: Inbox,
    tabs: [
      { href: "/inbox", label: "بدها قرارك" },
      { href: "/inbox/later", label: "مؤجّلة" },
      { href: "/inbox/done", label: "قررتها" },
    ],
    ready: true,
  },
  {
    key: "work",
    href: "/work",
    label: "الشغل",
    title: "الشغل",
    question: "مين عم يشتغل شو، وإمتى؟",
    icon: Workflow,
    tabs: [
      { href: "/work", label: "المجدولة" },
      { href: "/work/today", label: "اليوم" },
      { href: "/work/tasks", label: "مهام الفريق" },
      { href: "/work/reports", label: "التقارير" },
    ],
    ready: true,
    under: ["/tasks"],
  },
  {
    key: "ads",
    href: "/ads",
    label: "الإعلانات",
    title: "الإعلانات",
    question: "كيف ماشية الإعلانات بالحقيقة؟",
    icon: Megaphone,
    // the dashboard was distributed (v6 · P6): the campaigns table IS `/ads`; its tiles and the verdict of each product are in «الأرقام»
    tabs: [
      { href: "/ads", label: "الحملات", also: ["/ads/campaigns"] },
      { href: "/ads/videos", label: "الفيديوهات" },
      { href: "/ads/tests", label: "الاختبارات" },
    ],
    ready: true,
  },
  {
    key: "ops",
    href: "/ops",
    label: "التشغيل",
    title: "التشغيل",
    question: "كيف ماشي التأكيد والشحن والمخزون؟",
    icon: Truck,
    tabs: [
      { href: "/ops", label: "اللوحة" },
      { href: "/ops/confirm", label: "التأكيد" },
      { href: "/ops/shipping", label: "الشحن" },
      { href: "/ops/stock", label: "المخزون" },
    ],
    ready: true,
  },
];

/**
 * The new map (docs/rebuild-v6/02-screens.md §1). «بانتظارك» is not a place: the decisions are the first part of the home, and `/inbox` opens from «كل القرارات».
 * «التشغيل» is not a place either: it becomes a tab of «الأرقام» (P6) — until then «الأرقام» leads to the operations screens.
 */
export const PLACES_V6: readonly Place[] = [
  { key: "home", href: "/", label: "الرئيسية", title: "الرئيسية", question: "شو صاير هلق، وشو بدّه مني؟", icon: Home, tabs: [], ready: true, role: "home" },
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
    ready: true,
    role: "work",
    under: ["/work"],
  },
  {
    key: "numbers",
    href: "/numbers",
    label: "الأرقام",
    title: "الأرقام",
    question: "وين كنا، وكيف صرنا؟",
    icon: Gauge,
    // P6 builds the screens; the old addresses (`/ops`, `/ops/stock`, `/products`) stay until P8 and light the same tabs
    tabs: [
      { href: "/numbers", label: "الخلاصة" },
      { href: "/numbers/products", label: "المنتجات", also: ["/products"] },
      { href: "/numbers/ops", label: "التأكيد والشحن", also: ["/ops"] },
      { href: "/numbers/stock", label: "المخزون", also: ["/ops/stock"] },
    ],
    ready: true,
    roles: ["ads", "ops"],
    under: ["/numbers", "/ops", "/products"],
  },
  {
    key: "ads",
    href: "/ads",
    label: "الإعلانات",
    title: "الإعلانات",
    question: "الحملات والفيديوهات",
    icon: Megaphone,
    // its own tabs (الحملات · الفيديوهات · الاختبارات) are drawn by the ads layout until the places are rebuilt (§5): the new map does not duplicate them
    tabs: [],
    ready: true,
    role: "ads",
  },
];

/** The cookie that says which map a person sees. */
export const NAV_COOKIE = "mb_nav";
export type NavMap = "v6" | "old";
export const NAV_MAPS: Record<NavMap, readonly Place[]> = { v6: PLACES_V6, old: PLACES };

/**
 * Which map this person sees: what the cookie says; with no cookie the owner (and the manager) get the new one and everybody else the old one until P8.
 * Anything else in the cookie is ignored (it is a plain browser value).
 */
export function navMapFor(cookie: string | null | undefined, role: RoleKey | null | undefined): NavMap {
  if (cookie === "v6" || cookie === "old") return cookie;
  return role === "OWNER" || role === "MANAGER" ? "v6" : "old";
}

/** Where a place leads: its own address once its screens exist, else its old counterpart. */
export const hrefOfPlace = (p: Pick<Place, "href" | "ready" | "legacyHref">): string => (p.ready ? p.href : (p.legacyHref ?? p.href));

/** The places a role's bar has, for a map. */
export function placesFor(map: NavMap, roleBar: readonly string[]): Place[] {
  return NAV_MAPS[map].filter((p) => p.ready || p.legacyHref).filter((p) => (p.roles ? p.roles.some((r) => roleBar.includes(r)) : roleBar.includes(p.role ?? p.key)));
}

/** The settings live under the side menu, not in the places. */
export const SETTINGS = { key: "settings" as const, href: "/settings", label: "الإعدادات", title: "الإعدادات", question: "الربط والفريق والقواعد — مرة وبتنتسى", icon: Settings };

/** The places shown in the menu and the bottom bar of the old map (the ones whose screens exist). */
export const READY_PLACES: readonly Place[] = PLACES.filter((p) => p.ready);

/** What the page header shows: a place, the settings, or a screen that is under no place («المنتجات»). */
export interface Where {
  key: PlaceKey | "settings" | "products" | "other";
  label: string;
  title: string;
  question: string;
  href: string;
}

const OTHER: readonly Where[] = [
  { key: "products", label: "المنتجات", title: "المنتجات", question: "أرقام كل منتج من أوله لآخره", href: "/products" },
  { key: "settings", label: SETTINGS.label, title: SETTINGS.title, question: SETTINGS.question, href: SETTINGS.href },
];

/** Screens that are under no place of the new map: the decisions list (it opens from the home) and the full-screen ring. */
const OTHER_V6: readonly Where[] = [
  { key: "inbox", label: "بانتظارك", title: "بانتظارك", question: "شو بدّه قراري؟", href: "/inbox" },
  { key: "settings", label: SETTINGS.label, title: SETTINGS.title, question: SETTINGS.question, href: SETTINGS.href },
];

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);
const inPlace = (p: Place, pathname: string): boolean => (p.href !== "/" && under(pathname, p.href)) || (p.under ?? []).some((u) => under(pathname, u));

/**
 * The place (or settings, or products) of an address; anything unknown is the home. `map` is the one the person sees: the old map keeps «/tasks»
 * inside «الشغل», the new one keeps «/work» inside «المهام» and the operations and the products inside «الأرقام».
 */
export function placeOf(pathname: string, map: NavMap = "old"): Where {
  const places = NAV_MAPS[map];
  const hit = places.filter((p) => p.href !== "/").find((p) => inPlace(p, pathname));
  if (hit) return { key: hit.key, label: hit.label, title: hit.title, question: hit.question, href: hit.href };
  const other = (map === "v6" ? OTHER_V6 : OTHER).find((o) => under(pathname, o.href));
  if (other) return other;
  const home = places[0]!;
  return { key: home.key, label: home.label, title: home.title, question: home.question, href: home.href };
}

/** The tab of an address inside its place (the longest address that matches), or null for a place without tabs. */
export function tabOf(pathname: string, map: NavMap = "old"): PlaceTab | null {
  const place = NAV_MAPS[map].find((p) => p.href !== "/" && inPlace(p, pathname));
  if (!place) return null;
  const hits = (a: string) => pathname === a || pathname.startsWith(`${a}/`);
  const matching = place.tabs.filter((t) => pathname === t.href || (t.href !== place.href && pathname.startsWith(`${t.href}/`)) || (t.also ?? []).some(hits));
  // the longest address that matches wins (`/ops/stock` is «المخزون», not «التأكيد والشحن» whose old address is `/ops`)
  const length = (t: PlaceTab) => Math.max(t.href.length, ...(t.also ?? []).filter(hits).map((a) => a.length));
  return matching.sort((a, b) => length(b) - length(a))[0] ?? place.tabs[0] ?? null;
}

/**
 * The seven pages of v3 as plain data — what «وضع التعديل» (src/core/customize.ts) still starts from until P11 retires it.
 * The side menu no longer reads them.
 */
export const LEGACY_PAGES = [
  { key: "today", href: "/", label: "اليوم", question: "شو لازم أعمل هلأ؟", mobile: true },
  { key: "ads", href: "/ads", label: "الإعلانات", question: "كيف ماشية إعلاناتي بالحقيقة؟", mobile: true },
  { key: "videos", href: "/videos", label: "الفيديوهات", question: "شو الفيديوهات الجاية والشغّالة؟", mobile: false },
  { key: "tasks", href: "/tasks", label: "المهام", question: "شو بدو موافقتي، ومين عم يخلّص شو؟", mobile: true },
  { key: "workflow", href: "/workflow", label: "الورك فلو", question: "شو عم يشتغل هلأ، ومين بيعمله؟", mobile: true },
  { key: "done", href: "/done", label: "الإنجاز", question: "شو خلّصنا، وشو جاي بكرا؟", mobile: false },
  { key: "settings", href: "/settings", label: "الإعدادات", question: "الربط والسقوف والقواعد — مرة وبتنتسى", mobile: false },
] as const;

export const BUILTIN_PAGES: { key: string; href: string; label: string; question: string; mobile: boolean }[] = LEGACY_PAGES.map((p) => ({ ...p }));
