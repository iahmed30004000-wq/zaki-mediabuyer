import { CircleDot } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { SOURCES } from "@/lib/mock/data";
import { loadEditView } from "@/lib/settings-view";
import { cn } from "@/lib/utils";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الأتمتة والجدولة" };
export const dynamic = "force-dynamic";

const KEYS = ["stepRunner", "scheduler", "n8n"];

/**
 * الإعدادات ← متقدّم ← الأتمتة والجدولة: حالة n8n · تنفيذ الخطوات من الموقع (webhook ومواقع مسموحة) · ساعة الموقع (الحارس).
 * Read only: the keys and the allowed lists are written in Coolify; the site's clock always runs (there is no switch for it).
 */
export default async function AutomationPage() {
  await requirePage("settings.view");
  const edit = await loadEditView();
  const rows = (edit?.links ?? SOURCES).filter((l) => KEYS.includes(l.key));
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">هون بتشوف حالة الأتمتة بس. المفاتيح والمواقع المسموحة بتنكتب بـ Coolify. ساعة الموقع دايماً شغّالة: بتراقب كل مهمة بموعدها، ومهام Claude بتضل بتصحى لحالها.</p>
      {rows.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <Panel key={s.key} className="flex items-center gap-3">
              <CircleDot className={cn("size-4 shrink-0", s.state === "ok" ? "text-ok" : s.state === "late" ? "text-warn" : "text-fg-muted")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-fg">{s.label}</p>
                <p className="text-sm text-fg-muted">{s.detail}</p>
              </div>
            </Panel>
          ))}
        </div>
      ) : (
        <Panel className="text-sm text-fg-muted">الحالة بتبيّن لما يشتغل الموقع على البيانات الحقيقية (مش التجريبية).</Panel>
      )}
    </div>
  );
}
