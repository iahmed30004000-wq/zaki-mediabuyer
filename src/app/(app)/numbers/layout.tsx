import { Tabs } from "@/components/ui/tabs";
import { canOpenPath } from "@/core/roles";
import { PLACES } from "@/lib/nav";
import { currentCaller } from "@/server/auth";

/**
 * The tabs of «الأرقام» (الخلاصة · المنتجات · التأكيد والشحن · المخزون): only the ones this role may open — the ads' numbers and the operations' are different capabilities, so a role that has one of
 * them is not shown a tab that answers «هالصفحة مش من صلاحياتك».
 */
export default async function NumbersLayout({ children }: { children: React.ReactNode }) {
  const me = await currentCaller();
  const place = PLACES.find((p) => p.key === "numbers")!;
  const items = place.tabs.filter((t) => (!me || canOpenPath(me.role, t.href))).map((t) => ({ href: t.href, label: t.label }));
  return (
    <>
      {items.length > 1 ? <Tabs items={items} label={place.title} className="mb-4" /> : null}
      {children}
    </>
  );
}
