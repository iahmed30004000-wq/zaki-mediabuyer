/**
 * THE SETTINGS MAP (docs/rebuild/02-structure.md §3.7, plus «الإشعارات» from v6 · P7): seven pages, and «متقدّم» holds five more. The long page of v1–v4 is gone; its old `#anchors` are sent to the
 * new address by the browser (a hash never reaches the server), and `/settings#guide` etc. that older alerts and messages stored keep working.
 */
export interface SettingsPage {
  href: string;
  title: string;
  /** one line under the title in the list */
  line: string;
}

export const SETTINGS_PAGES: readonly SettingsPage[] = [
  { href: "/settings/connections", title: "الربط", line: "جاهزية الربط، ربط Claude والاستوديو، الكتابة على ميتا" },
  { href: "/settings/team", title: "الفريق والصلاحيات", line: "الناس وأدوارهم، دليل الفريق، توكنات الوكلاء، مين بيقدر شو" },
  { href: "/settings/rules", title: "القواعد", line: "السقوف، مستوى كل حساب، أحكام الحملات، صاحي ونايم، الأوامر السارية" },
  { href: "/settings/products", title: "المنتجات", line: "الأسعار والتكاليف ونقطة التعادل، الصفحات، صفحات الهبوط" },
  { href: "/settings/notifications", title: "الإشعارات", line: "شو بيرنّ على جوالك وشو بالجرس، أجهزتك، وصاحي ونايم" },
  { href: "/settings/look", title: "المظهر", line: "فاتح أو داكن" },
  { href: "/settings/advanced", title: "متقدّم", line: "التخصيص، الأتمتة والجدولة، الإدخال اليدوي، السجل، الدليل" },
];

export const ADVANCED_PAGES: readonly SettingsPage[] = [
  { href: "/settings/advanced/customize", title: "التخصيص", line: "لوحات المهام، حقول البطاقات وأزرارها، المحذوفات، روابطي" },
  { href: "/settings/advanced/automation", title: "الأتمتة والجدولة", line: "n8n، تنفيذ الخطوات من الموقع، الجدولة" },
  { href: "/settings/advanced/manual", title: "الإدخال اليدوي", line: "لصق الأرقام، الاستيراد، التصدير" },
  { href: "/settings/advanced/log", title: "السجل", line: "مين عمل شو ومتى: ناس، قواعد، وكلاء، النظام" },
  { href: "/settings/advanced/guide", title: "الدليل", line: "الأماكن، الأسئلة اللي بتتكرر، وكل رقم من وين" },
];

/** The title of any settings address, for the line under the header. */
export function settingsTitle(path: string): string | null {
  const all = [...SETTINGS_PAGES, ...ADVANCED_PAGES];
  return all.find((p) => p.href === path)?.title ?? null;
}

/** Where the parent of a settings address is (for «← رجوع»); the list has none. */
export function settingsParent(path: string): { href: string; title: string } | null {
  if (path === "/settings") return null;
  if (path.startsWith("/settings/advanced/")) return { href: "/settings/advanced", title: "متقدّم" };
  return { href: "/settings", title: "الإعدادات" };
}

/** The old `#anchors` of the long page → the page that holds the editor now. */
export const SETTINGS_HASH: Readonly<Record<string, string>> = {
  setup: "/settings/connections",
  connections: "/settings/connections",
  readiness: "/settings/connections",
  money: "/settings/rules",
  rules: "/settings/rules",
  "campaign-rules": "/settings/rules",
  mode: "/settings/notifications",
  orders: "/settings/rules",
  products: "/settings/products",
  agents: "/settings/team",
  team: "/settings/team",
  import: "/settings/advanced/manual",
  guide: "/settings/advanced/guide",
  look: "/settings/look",
};

/** The address an old `/settings#hash` means, or null when it is not one of the old anchors. */
export const settingsFromHash = (hash: string): string | null => SETTINGS_HASH[hash.replace(/^#/, "")] ?? null;
