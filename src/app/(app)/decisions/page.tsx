import { ChangeCard } from "@/components/mb/change-card";
import { LevelStars } from "@/components/mb/level-stars";
import { Panel, Section } from "@/components/mb/section";
import { EmptyState } from "@/components/ui/card";
import { loadChanges } from "@/lib/changes-view";
import { loadDataset } from "@/lib/source";

export const metadata = { title: "القرارات" };

/** The rules in the owner's words (spec 6.4) — read here, edited under Settings. */
const RULES = [
  { key: "الخاسر بلا طلبات", when: "صرف ضعف هدف الطلب بـ 48 ساعة وصفر طلبات", does: "بيوقف الإعلان", auto: true },
  { key: "الخاسر بلا مؤكد", when: "صرف 1.5 × سقف التكبير، 3 طلبات ناضجة وصفر مؤكد", does: "بيوقف الإعلان", auto: true },
  { key: "تكلفة مؤكد عالية", when: "فوق سقف التكبير بعد أول 100$ للمنتج", does: "بيخفّض المجموعة 30%", auto: true },
  { key: "السقف اليومي", when: "صرف الحساب وصل السقف", does: "بيوقف غير المحمي لآخر اليوم", auto: true },
  { key: "قفزة صرف", when: "ساعة صرفت 3 أضعاف المعتاد", does: "بيخفّض 30% وبيبلّغك", auto: true },
  { key: "المخزون", when: "أقل من يومين / أقل من 5 أيام", does: "بيوقف / بيجمّد التكبير", auto: true },
  { key: "سلّم التكبير", when: "تكلفة المؤكد تحت السقف 3 أيام بـ 5 مؤكد", does: "بيقترح +20% كل 48 ساعة", auto: false },
];

export const dynamic = "force-dynamic";

export default async function DecisionsPage() {
  const [changes, ds] = await Promise.all([loadChanges(), loadDataset()]);
  const pending = changes.filter((c) => c.state === "pending_approval");
  const auto = changes.filter((c) => c.state !== "pending_approval" && c.auto);
  const history = changes.filter((c) => c.state !== "pending_approval" && !c.auto);

  return (
    <div className="space-y-8">
      <Section title="بانتظارك" hint="أي زيادة صرف أو إنشاء — بالموقع بس، أبداً من تيليجرام" tour="pending">
        {pending.length ? (
          <div className="grid gap-3 lg:grid-cols-2">{pending.map((c) => <ChangeCard key={c.id} change={c} />)}</div>
        ) : (
          <EmptyState title="ما في شي بانتظارك" hint="لما قاعدة أو وكيل يقترح صرف، بيوصلك هون وعلى تيليجرام كتنبيه." art="empty-decisions" />
        )}
      </Section>

      <Section title="صار تلقائي" hint="الأمان ما بيستنى: الإيقاف والتخفيض تلقائي ضمن مستوى الحساب">
        <div className="grid gap-3 lg:grid-cols-2">{auto.map((c) => <ChangeCard key={c.id} change={c} />)}</div>
      </Section>

      <Section title="السجل" hint="القرارات اليدوية والمرجوعة">
        <div className="grid gap-3 lg:grid-cols-2">{history.map((c) => <ChangeCard key={c.id} change={c} />)}</div>
      </Section>

      <Section title="القواعد" hint="شو بيصير لحاله وشو بدو موافقتك — بتتعدّل من الإعدادات" tour="rules" link={{ href: "/settings#rules", label: "عدّل القواعد" }}>
        <div className="flex flex-wrap gap-3">
          {ds.accounts.map((a) => (
            <Panel key={a.id} className="flex items-center gap-3 py-2">
              <span className="text-sm font-medium text-fg">{a.name}</span>
              <LevelStars level={a.level} />
            </Panel>
          ))}
        </div>
        <Panel className="divide-y divide-border p-0">
          {RULES.map((r) => (
            <div key={r.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-36 shrink-0 text-sm font-semibold text-fg">{r.key}</span>
              <span className="flex-1 text-xs text-fg-muted">لما {r.when}</span>
              <span className="text-xs text-fg">{r.does}</span>
              <span className={r.auto ? "rounded-md bg-ok/10 px-1.5 py-0.5 text-[11px] font-semibold text-ok" : "rounded-md bg-warn/10 px-1.5 py-0.5 text-[11px] font-semibold text-warn"}>{r.auto ? "تلقائي" : "بموافقتك"}</span>
            </div>
          ))}
        </Panel>
      </Section>
    </div>
  );
}
