import { FoldCard } from "@/components/settings/fold-card";
import { AnthropicLink } from "@/components/settings/anthropic-link";
import { ClaudeLink } from "@/components/settings/claude-link";
import { ConnectionsPanel } from "@/components/settings/connections-panel";
import { PurchaseOnPicker } from "@/components/settings/editors";
import { StudioLink } from "@/components/settings/studio-link";
import { ReadinessPanel } from "@/components/setup/readiness-panel";
import { Panel } from "@/components/mb/section";
import { isDemo } from "@/core/readiness";
import { loadReadiness } from "@/lib/readiness-view";
import { loadEditView } from "@/lib/settings-view";
import { cn } from "@/lib/utils";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الربط" };
export const dynamic = "force-dynamic";

/**
 * الإعدادات ← الربط (للمالك بس): «المفاتيح والروابط» (كل سطر: اكتب/ارفع المفتاح مرة وما بيرجع، أو «اربط ← اسمح» بين أنظمتنا، و«اختبر الربط») · جاهزية الربط ·
 * ربط Claude والاستوديو · الكتابة على ميتا. A value saved here wins over Coolify's; delete it and Coolify's comes back (D62).
 */
export default async function ConnectionsPage() {
  await requirePage("owner_only");
  const [readiness, edit] = await Promise.all([loadReadiness(), loadEditView()]);
  const linked = readiness.rows.filter((r) => r.linked).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">اكتب المفتاح هون مرة وحدة وما بيرجع يظهر. الربط بين أنظمتنا بزر «اربط ← اسمح» بلا نسخ ولصق. ولسا مفاتيح Coolify شغّالة إذا ما كتبت شي هون.</p>
      <FoldCard id="keys" open title="المفاتيح والروابط" summary="ميتا · جوجل درايف · الـOMS · الردود · Workspace">
        <ConnectionsPanel />
      </FoldCard>
      <FoldCard id="readiness" title="جاهزية الربط" summary={`${linked} من ${readiness.rows.length} مربوطين`}>
        <ReadinessPanel data={readiness} />
      </FoldCard>
      <FoldCard id="claude" title="ربط Claude" summary="مفتاح المساعد، وتوكن الموصّل اللي بيستعمله Claude">
        <div className="grid gap-3 md:grid-cols-2">
          <AnthropicLink />
          <ClaudeLink mock={isDemo(process.env)} />
        </div>
      </FoldCard>
      <FoldCard id="studio" title="ربط الاستوديو" summary="توكن للاستوديو اللي بيطلب ويسلّم الفيديوهات">
        <StudioLink />
      </FoldCard>
      {edit ? (
        <FoldCard id="meta-write" title="الكتابة على ميتا وحساب «شراء»" summary={edit.writeMode === "live" ? "الكتابة حقيقية" : "الكتابة تجريبية"}>
          <div className="grid gap-3 md:grid-cols-2">
            <Panel className="space-y-1">
              <p className="text-sm font-semibold text-fg">الكتابة على ميتا</p>
              <p className={cn("text-sm", edit.writeMode === "live" ? "text-warn" : "text-fg-muted")}>{edit.writeMode === "live" ? "حقيقية — كل قرار بيوصل لميتا" : "تجريبية — كل قرار بيتسجّل وما بيوصل لميتا"}</p>
            </Panel>
            <PurchaseOnPicker value={edit.purchaseOn} />
          </div>
        </FoldCard>
      ) : null}
    </div>
  );
}
