import { ChangeCard } from "@/components/mb/change-card";
import { Section } from "@/components/mb/section";
import type { ChangeView } from "@/lib/changes-view";

/** What happened on its own (the safety rules) and the manual / reverted decisions — read-only, each with its revert. */
export function DecisionsLog({ changes }: { changes: ChangeView[] }) {
  const auto = changes.filter((c) => c.state !== "pending_approval" && c.auto);
  const history = changes.filter((c) => c.state !== "pending_approval" && !c.auto);
  return (
    <div data-tour="log" className="space-y-8">
      <Section title="صار تلقائي" hint="الأمان ما بيستنى: الإيقاف والتخفيض تلقائي ضمن مستوى الحساب">
        <div className="grid gap-3 lg:grid-cols-2">{auto.map((c) => <ChangeCard key={c.id} change={c} />)}</div>
      </Section>
      <Section title="السجل" hint="القرارات اليدوية والمرجوعة">
        <div className="grid gap-3 lg:grid-cols-2">{history.map((c) => <ChangeCard key={c.id} change={c} />)}</div>
      </Section>
    </div>
  );
}
