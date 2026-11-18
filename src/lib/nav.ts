/**
 * THE MAP — five places and the settings (v5, docs/rebuild/02-structure.md; it was seven in v3, D18). One question per place;
 * nothing lives in two places; two levels of navigation at most (a place, then a tab). The assistant is an icon in the header.
 *
 *   الرئيسية   «شو بدّه مني، وكيف الوضع؟»                 لوحة المالك
 *   بانتظارك   «شو بدّه قراري؟»                            كل قرار، ببطاقة وحدة
 *   الشغل      «مين عم يشتغل شو، وإمتى؟»                  خريطة المهام المجدولة · اليوم · مهام الفريق · التقارير
 *   الإعلانات  «كيف ماشية الإعلانات بالحقيقة؟»            لوحة · حملات · فيديوهات · اختبارات
 *   التشغيل    «كيف ماشي التأكيد والشحن والمخزون؟»        (read only)
 *   الإعدادات  الربط، الفريق، القواعد، المنتجات، المظهر، متقدّم
 *
 * Old addresses still work: next.config.mjs redirects them (tests/nav.test.ts holds the table).
 */
import type { LucideIcon } from "lucide-react";
import { Home, Inbox, Megaphone, Settings, Truck, Workflow } from "lucide-react";

export type PlaceKey = "home" | "inbox" | "work" | "ads" | "ops";

export interface PlaceTab {
  /** The address of the tab; a `?query` part is matched too. */
  href: string;
  label: string;
  /** false until the phase that builds the screen: a tab with no screen is not shown. */
  ready?: boolean;
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
  /** A place whose screens are not built yet is not shown (no «قريباً» screens). */
  ready: boolean;
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
  },
  {
    key: "ads",
    href: "/ads",
    label: "الإعلانات",
    title: "الإعلانات",
    question: "كيف ماشية الإعلانات بالحقيقة؟",
    icon: Megaphone,
    tabs: [
      { href: "/ads", label: "اللوحة" },
      { href: "/ads/campaigns", label: "الحملات" },
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

/** The settings live under the side menu, not in the five. */
export const SETTINGS = { key: "settings" as const, href: "/settings", label: "الإعدادات", title: "الإعدادات", question: "الربط والفريق والقواعد — مرة وبتنتسى", icon: Settings };

/** The places shown in the menu and the bottom bar (the ones whose screens exist). */
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

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

/** The place (or settings, or products) of an address; anything unknown is the home. */
export function placeOf(pathname: string): Where {
  const hit = PLACES.filter((p) => p.href !== "/").find((p) => under(pathname, p.href));
  if (hit) return { key: hit.key, label: hit.label, title: hit.title, question: hit.question, href: hit.href };
  const other = OTHER.find((o) => under(pathname, o.href));
  if (other) return other;
  const home = PLACES[0]!;
  return { key: home.key, label: home.label, title: home.title, question: home.question, href: home.href };
}

/** The tab of an address inside its place (the longest address that matches), or null for a place without tabs. */
export function tabOf(pathname: string): PlaceTab | null {
  const place = PLACES.find((p) => p.href !== "/" && under(pathname, p.href));
  if (!place) return null;
  const matching = place.tabs.filter((t) => pathname === t.href || (t.href !== place.href && pathname.startsWith(`${t.href}/`)));
  return matching.sort((a, b) => b.href.length - a.href.length)[0] ?? place.tabs[0] ?? null;
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
