"use client";

import { Button } from "@/components/ui/button";
import { EditToggle } from "@/components/customize/edit-bar";
import { useShell, type PanelTab } from "@/components/shell/shell-context";

const ITEMS: { tab: PanelTab; title: string; line: string }[] = [
  { tab: "boards", title: "لوحات المهام", line: "ضيف لوحة أو غيّر اسمها أو رتّبها أو خبّيها" },
  { tab: "fields", title: "حقول البطاقات", line: "حقل إضافي على بطاقة المهمة (نص، رقم، خيارات)" },
  { tab: "buttons", title: "أزرار البطاقات", line: "زر بيعمل شي معروف على البطاقة" },
  { tab: "trash", title: "المحذوفات", line: "اللي أرشفته — بيرجع بضغطة، ولا شي بينحذف نهائياً" },
];

/** The edit mode, in one place: switch it on, and open the panel at the part you want. Only the owner, signed in. */
export function CustomizeHub() {
  const { canEdit, editing, setEditing, openPanel } = useShell();
  if (!canEdit) return <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">التخصيص للمالك، وبعد ما يسجّل دخول.</p>;
  return (
    <div className="space-y-3">
      <EditToggle />
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
        {ITEMS.map((i) => (
          <li key={i.tab} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block text-base font-extrabold text-fg">{i.title}</span>
              <span className="block text-sm text-fg-muted">{i.line}</span>
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setEditing(true);
                openPanel(i.tab);
              }}
            >
              افتح
            </Button>
          </li>
        ))}
      </ul>
      {!editing ? <p className="text-sm text-fg-muted">«افتح» بيشغّل وضع التعديل وبيفتح اللوحة. بتطفيه من نفس الزر فوق.</p> : null}
    </div>
  );
}
