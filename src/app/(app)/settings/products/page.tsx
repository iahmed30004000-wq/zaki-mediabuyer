import { Panel } from "@/components/mb/section";
import { LandingEditor, PagesEditor, ProductsEditor } from "@/components/settings/editors";
import { FoldCard } from "@/components/settings/fold-card";
import { loadEditView } from "@/lib/settings-view";
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
    return <Panel className="text-base text-fg-muted">أسعار المنتجات وصفحاتها بتنعرض لما يشتغل الموقع على البيانات الحقيقية (مش التجريبية).</Panel>;
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
