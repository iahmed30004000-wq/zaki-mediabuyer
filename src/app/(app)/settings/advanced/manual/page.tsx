import { PasteNumbers } from "@/components/numbers/paste-numbers";
import { ImportPanel } from "@/components/settings/import-panel";
import { SectionTitle } from "@/components/ui/section-title";
import { addDays, ammanKey } from "@/core/dates";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "الإدخال اليدوي" };
export const dynamic = "force-dynamic";

/** الإعدادات ← متقدّم ← الإدخال اليدوي: لصق أرقام يوم · استيراد ملف · تصدير. نفس الملف مرتين = مرة. */
export default async function ManualPage() {
  const me = await currentCaller();
  const owner = !!me && !me.demo && !isDemo(process.env) && can(me.role, "owner_only");
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle hint="أرقام يوم من إكسل أو من أي مصدر — بتتفحص قبل ما تنحفظ">ألصق أرقام</SectionTitle>
        <PasteNumbers defaultDay={addDays(ammanKey(new Date()), -1)} />
      </section>
      <section className="space-y-3">
        <SectionTitle hint="رفع ← ربط الأعمدة ← معاينة ← استيراد · نفس الملف مرتين = مرة">الاستيراد والتصدير</SectionTitle>
        <ImportPanel />
      </section>
      {owner ? null : <p className="text-sm text-fg-muted">الحفظ للمالك بس.</p>}
    </div>
  );
}
