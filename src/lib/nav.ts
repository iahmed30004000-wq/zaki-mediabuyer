/**
 * THE MAP — seven places (v3, DECISIONS D18; it was five + the settings in D1). One question per place; nothing lives
 * in two places. The assistant is a floating button on every page, not a place.
 *
 *   اليوم       الأرقام + بانتظارك + التنبيهات                       «شو لازم أعمل هلأ؟»
 *   الإعلانات   الشجرة + الصحة + سلّم التكبير + الاختبارات            «كيف ماشية إعلاناتي بالحقيقة؟»
 *   الفيديوهات  مسار الفيديو (وارد ← جاهز ← شغّال ← متعب)            «شو الفيديوهات الجاية والشغّالة؟»
 *   المهام      كانبان + «بانتظار موافقتك» (كانت القرارات)           «شو بدو موافقتي، ومين عم يخلّص شو؟»
 *   الورك فلو   الشغل اللي بيمشي: مين، متى، وشو آخر نتيجة            «شو عم يشتغل هلأ؟»
 *   الإنجاز     شو انعمل (أي يوم) وشو جاي بكرا + التقارير            «شو خلّصنا؟»
 *   الإعدادات   الربط (كان «جهّز النظام»)، السقوف، القواعد، الدليل    كل شي بيتعدّل مرة وبينتسى
 *
 * Old addresses still work: next.config.mjs redirects them (tests/nav.test.ts holds the table).
 */
import type { LucideIcon } from "lucide-react";
import { CheckCheck, Clapperboard, ListChecks, Megaphone, Settings, Sun, Workflow } from "lucide-react";

export interface Place {
  key: "today" | "ads" | "videos" | "tasks" | "workflow" | "done" | "settings";
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
  { key: "videos", href: "/videos", label: "الفيديوهات", question: "شو الفيديوهات الجاية والشغّالة؟", icon: Clapperboard, mobile: false },
  { key: "tasks", href: "/tasks", label: "المهام", question: "شو بدو موافقتي، ومين عم يخلّص شو؟", icon: ListChecks, mobile: true },
  { key: "workflow", href: "/workflow", label: "الورك فلو", question: "شو عم يشتغل هلأ، ومين بيعمله؟", icon: Workflow, mobile: true },
  { key: "done", href: "/done", label: "الإنجاز", question: "شو خلّصنا، وشو جاي بكرا؟", icon: CheckCheck, mobile: false },
  { key: "settings", href: "/settings", label: "الإعدادات", question: "الربط والسقوف والقواعد — مرة وبتنتسى", icon: Settings, mobile: false },
];

/** The places as plain data (no icons): what «وضع التعديل» starts from (src/core/customize.ts). */
export const BUILTIN_PAGES = PLACES.map((p) => ({ key: p.key as string, href: p.href, label: p.label, question: p.question, mobile: p.mobile }));

export function placeOf(pathname: string): Place {
  const hit = PLACES.filter((p) => p.href !== "/").find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
  return hit ?? PLACES[0]!;
}
