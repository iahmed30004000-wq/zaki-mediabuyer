import { TabNav } from "@/components/shell/tab-nav";

export const ADS_TABS = [
  { key: "campaigns", label: "حسب الحملة" },
  { key: "products", label: "حسب المنتج" },
  { key: "tests", label: "الاختبارات" },
  { key: "health", label: "الصحة" },
  { key: "scale", label: "سلّم التكبير" },
] as const;

/** The same tab bar as the client view, as links — for the tabs that are their own server-rendered pages (health, scale). */
export function AdsTabs({ active }: { active: string }) {
  return <TabNav tabs={ADS_TABS} active={active} base="/ads" label="الإعلانات" tour="tabs" />;
}
