import { Num } from "@/components/mb/num";
import { Panel } from "@/components/mb/section";
import { LandingEditor, PagesEditor, ProductsEditor } from "@/components/settings/editors";
import { FoldCard } from "@/components/settings/fold-card";
import { loadEditView } from "@/lib/settings-view";
import { fmt } from "@/lib/format";
import { PRODUCTS, targetsOf } from "@/lib/mock/data";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المنتجات" };
export const dynamic = "force-dynamic";

/**
 * الإعدادات ← المنتجات: الأسعار والتكاليف ونقطة التعادل (بتنسحب من الـ OMS لما ينربط) · صفحات الفيسبوك ورموزها · صفحات الهبوط. Each is a folded card
 * with its own one-line summary; the editors are the ones that were on the long page, moved whole.
 */
export default async function ProductsSettingsPage() {
  await requirePage("settings.view");
  const edit = await loadEditView();
  if (!edit) {
    return (
      <Panel className="overflow-x-auto p-0">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="bg-surface-2 text-sm text-fg-muted">
            <tr>
              {["المنتج", "السعر", "تكلفة الوحدة", "التوصيل", "المرتجع", "هدف الطلب"].map((h) => (
                <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {PRODUCTS.map((p) => {
              const t = targetsOf(p);
              return (
                <tr key={p.code}>
                  <td className="px-3 py-2 text-fg">{p.name} <span dir="ltr" className="tabular-nums text-xs text-fg-muted">{p.code}</span></td>
                  {[p.price, p.unitCost, p.delivery, p.returnFee].map((n, i) => (
                    <td key={i} dir="ltr" className="px-3 py-2 text-end tabular-nums text-fg">{fmt(n, "$")}</td>
                  ))}
                  <td className="px-3 py-2"><Num value={t.tOrder} unit="$" term="tOrder" source={t.estimated ? "estimate" : "truth"} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
    );
  }
  return (
    <div className="space-y-3">
      <FoldCard id="products" open title="أسعار المنتجات وتكاليفها" summary={`${edit.products.length} منتج · نقطة التعادل بتنحسب منها`}>
        <ProductsEditor products={edit.products} />
      </FoldCard>
      <FoldCard id="pages" title="صفحات الفيسبوك" summary={`${edit.pages.length} صفحة ورمز كل واحدة`}>
        <PagesEditor pages={edit.pages} />
      </FoldCard>
      <FoldCard id="landing" title="صفحات الهبوط" summary={`${edit.landing.length} صفحة بروابطها`}>
        <LandingEditor landing={edit.landing} products={edit.products} />
      </FoldCard>
    </div>
  );
}
