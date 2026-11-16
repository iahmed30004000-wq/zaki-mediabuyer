"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell/shell-context";

/** «وضع التعديل» on and off — a button in «متقدّم ← التخصيص». Only the owner, signed in, ever sees it. */
export function EditToggle({ className }: { className?: string }) {
  const { canEdit, editing, setEditing } = useShell();
  if (!canEdit) return null;
  return (
    <Button variant={editing ? "primary" : "secondary"} aria-pressed={editing} className={className} onClick={() => setEditing(!editing)}>
      <Pencil className="size-4" aria-hidden />
      {editing ? "وضع التعديل شغّال" : "وضع التعديل"}
    </Button>
  );
}

/** The strip under the header while edit mode is on: it says so, and opens the panel where everything is changed. */
export function EditBar() {
  const { canEdit, editing, setEditing, openPanel } = useShell();
  if (!canEdit || !editing) return null;
  return (
    <div className="border-t border-accent/30 bg-accent/5" role="region" aria-label="وضع التعديل">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2 text-sm md:px-6">
        <Pencil className="size-4 text-accent" />
        <span className="font-semibold text-fg">وضع التعديل شغّال</span>
        <span className="hidden text-xs text-fg-muted sm:inline">الصفحات واللوحات والحقول والأزرار — كل تعديل بيتحفظ فوراً</span>
        <Button size="sm" className="ms-auto min-h-9" onClick={() => openPanel()}>
          افتح لوحة التعديل
        </Button>
        <Button size="sm" variant="secondary" className="min-h-9" onClick={() => setEditing(false)}>
          خلصت
        </Button>
      </div>
    </div>
  );
}
