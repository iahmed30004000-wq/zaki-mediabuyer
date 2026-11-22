"use client";

import { Button } from "@/components/ui/button";
import { useShell, type PanelTab } from "@/components/shell/shell-context";

const ITEMS: { tab: PanelTab; title: string; line: string }[] = [
  { tab: "boards", title: "لوحات مهام الفريق", line: "ضيف لوحة أو غيّر اسمها أو رتّبها أو خبّيها" },
  { tab: "fields", title: "حقول البطاقات", line: "حقل إضافي على بطاقة المهمة (نص، رقم، خيارات)" },
  { tab: "trash", title: "المحذوفات", line: "اللي أرشفته — بيرجع بضغطة، ولا شي بينحذف نهائياً" },
];

/** The boards and the fields of the team's tasks (v6 · P8, Q5: all that is left of the old edit mode), in one place: open the panel at the part you want. Only the owner, signed in. */
export function CustomizeHub() {
  const { canEdit, openPanel } = useShell();
  if (!canEdit) return <p className="rounded-card border border-dashed border-border p-4 text-base text-fg-muted">التخصيص للمالك، وبعد ما يسجّل دخول.</p>;
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
      {ITEMS.map((i) => (
        <li key={i.tab} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-base font-extrabold text-fg">{i.title}</span>
            <span className="block text-base text-fg-muted">{i.line}</span>
          </span>
          <Button size="sm" variant="secondary" onClick={() => openPanel(i.tab)}>
            افتح
          </Button>
        </li>
      ))}
    </ul>
  );
}
