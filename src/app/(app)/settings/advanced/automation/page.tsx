import { CircleDot } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { SOURCES } from "@/lib/mock/data";
import { loadEditView } from "@/lib/settings-view";
import { cn } from "@/lib/utils";

export const metadata = { title: "الأتمتة والجدولة" };
export const dynamic = "force-dynamic";

const KEYS = ["stepRunner", "scheduler", "n8n"];

/**
 * الإعدادات ← متقدّم ← الأتمتة والجدولة: حالة n8n (هل بيصحّي Claude بمواعيده) · تنفيذ الخطوات من الموقع (webhook ومواقع مسموحة) · الجدولة من الموقع.
 * Read only: the keys and the allowed lists are written in Coolify; the scheduler stays off until the owner turns it on there.
 */
export default async function AutomationPage() {
  const edit = await loadEditView();
  const rows = (edit?.links ?? SOURCES).filter((l) => KEYS.includes(l.key));
  return (
    <div className="space-y-4">
      <p className="text-sm text-fg-muted">هون بتشوف حالة الأتمتة بس. المفاتيح والمواقع المسموحة بتنكتب بـ Coolify، وتشغيل الجدولة من الموقع بيضل مطفي لحد ما تشغّله إنت هناك.</p>
      {rows.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {rows.map((s) => (
            <Panel key={s.key} className="flex items-center gap-3">
              <CircleDot className={cn("size-4 shrink-0", s.state === "ok" ? "text-ok" : s.state === "late" ? "text-warn" : "text-fg-muted")} aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-fg">{s.label}</p>
                <p className="text-xs text-fg-muted">{s.detail}</p>
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
