import { Panel } from "@/components/mb/section";

/** The guard's rules in the owner's words (spec 6.4) — read here; the level of each account is set just above. */
export const GUARD_RULES = [
  { key: "الخاسر بلا طلبات", when: "صرف ضعف هدف الطلب بـ 48 ساعة وصفر طلبات", does: "بيوقف الإعلان", auto: true },
  { key: "الخاسر بلا مؤكد", when: "صرف 1.5 × سقف التكبير، 3 طلبات ناضجة وصفر مؤكد", does: "بيوقف الإعلان", auto: true },
  { key: "تكلفة مؤكد عالية", when: "فوق سقف التكبير بعد أول 100$ للمنتج", does: "بيخفّض المجموعة 30%", auto: true },
  { key: "السقف اليومي", when: "صرف الحساب وصل السقف", does: "بيوقف غير المحمي لآخر اليوم", auto: true },
  { key: "قفزة صرف", when: "ساعة صرفت 3 أضعاف المعتاد", does: "بيخفّض 30% وبيبلّغك", auto: true },
  { key: "المخزون", when: "أقل من يومين / أقل من 5 أيام", does: "بيوقف / بيجمّد التكبير", auto: true },
  { key: "سلّم التكبير", when: "تكلفة المؤكد تحت السقف 3 أيام بـ 5 مؤكد", does: "+20% كل 48 ساعة، لحد +50% بالأسبوع", auto: false, autoFrom: "تلقائي من المكبّر المحدود" },
] as const;

export function RulesTable() {
  return (
    <Panel className="divide-y divide-border p-0">
      {GUARD_RULES.map((r) => (
        <div key={r.key} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <span className="w-36 shrink-0 text-sm font-semibold text-fg">{r.key}</span>
          <span className="flex-1 text-xs text-fg-muted">لما {r.when}</span>
          <span className="text-xs text-fg">{r.does}</span>
          <span className={r.auto ? "rounded-md bg-ok/10 px-1.5 py-0.5 text-[11px] font-semibold text-ok" : "rounded-md bg-warn/10 px-1.5 py-0.5 text-[11px] font-semibold text-warn"}>{r.auto ? "تلقائي" : "autoFrom" in r ? `بموافقتك · ${r.autoFrom}` : "بموافقتك"}</span>
        </div>
      ))}
    </Panel>
  );
}
