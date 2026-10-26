/**
 * THE MAP — five places and the settings (the spec's 18 screens, merged; see docs/DECISIONS.md).
 * One question per place; nothing lives in two places.
 *
 *   اليوم      S01 + S12 summary + alerts          «شو لازم أعمل هلأ؟»
 *   الإعلانات  S03 + S04 (side panel) + S05 + S08    «كيف ماشية إعلاناتي بالحقيقة؟»
 *   الإبداعات  S06                                  «شو الفيديوهات اللي جاية والشغّالة؟»
 *   القرارات   S07 + S09 (read)                     «شو بدو موافقتي، وشو صار لحاله؟»
 *   التقارير   S15 + S10 + S11                      «كيف كان الأسبوع، والبيانات سليمة؟»
 *   الإعدادات  S02 S12 S09 S13 S16 S17 S18          كل شي بيتعدّل مرة وبينتسى
 *   المستشار (S14) is a floating button on every page, not a place.
 */
import type { LucideIcon } from "lucide-react";
import { BarChart3, Clapperboard, Gavel, Megaphone, Settings, Sun } from "lucide-react";

export interface Place {
  key: "today" | "ads" | "creatives" | "decisions" | "reports" | "settings";
  href: string;
  label: string;
  /** The one question the place answers (shown under the title). */
  question: string;
  icon: LucideIcon;
  /** Shown in the phone's bottom bar (the rest are under «المزيد»). */
  mobile: boolean;
}

export const PLACES: readonly Place[] = [
  { key: "today", href: "/", label: "اليوم", question: "شو لازم أعمل هلأ؟", icon: Sun, mobile: true },
  { key: "ads", href: "/ads", label: "الإعلانات", question: "كيف ماشية إعلاناتي بالحقيقة؟", icon: Megaphone, mobile: true },
  { key: "decisions", href: "/decisions", label: "القرارات", question: "شو بدو موافقتي، وشو صار لحاله؟", icon: Gavel, mobile: true },
  { key: "creatives", href: "/creatives", label: "الإبداعات", question: "شو الفيديوهات الجاية والشغّالة؟", icon: Clapperboard, mobile: true },
  { key: "reports", href: "/reports", label: "التقارير", question: "كيف كان الأسبوع، والبيانات سليمة؟", icon: BarChart3, mobile: false },
  { key: "settings", href: "/settings", label: "الإعدادات", question: "الربط والسقوف والقواعد — مرة وبتنتسى", icon: Settings, mobile: false },
];

export function placeOf(pathname: string): Place {
  const hit = PLACES.filter((p) => p.href !== "/").find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  return hit ?? PLACES[0]!;
}
