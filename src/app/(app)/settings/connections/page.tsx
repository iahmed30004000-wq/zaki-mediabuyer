import { FoldCard } from "@/components/settings/fold-card";
import { AnthropicLink } from "@/components/settings/anthropic-link";
import { ClaudeLink } from "@/components/settings/claude-link";
import { PurchaseOnPicker } from "@/components/settings/editors";
import { StudioLink } from "@/components/settings/studio-link";
import { ReadinessPanel } from "@/components/setup/readiness-panel";
import { Panel } from "@/components/mb/section";
import { isDemo } from "@/core/readiness";
import { loadReadiness } from "@/lib/readiness-view";
import { loadEditView } from "@/lib/settings-view";
import { cn } from "@/lib/utils";

export const metadata = { title: "الربط" };
export const dynamic = "force-dynamic";

/**
 * الإعدادات ← الربط: «جاهزية الربط» (كل رابط، هل مفتاحه موجود ومتى صار آخر نداء حقيقي — بأسماء الناقص بس) · ربط Claude والاستوديو · الكتابة على ميتا · متى
 * بينحسب «شراء». The keys themselves are written in Coolify or the .env file only — never here, never in a chat.
 */
export default async function ConnectionsPage() {
  const [readiness, edit] = await Promise.all([loadReadiness(), loadEditView()]);
  const linked = readiness.rows.filter((r) => r.linked).length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-muted">المفاتيح بتنكتب بـ Coolify أو ملف .env بس — ولا مرة بالموقع ولا بالمحادثة.</p>
      <FoldCard id="readiness" open title="جاهزية الربط" summary={`${linked} من ${readiness.rows.length} مربوطين`}>
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
