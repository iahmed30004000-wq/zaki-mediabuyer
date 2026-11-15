"use client";

import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useShell } from "@/components/shell/shell-context";
import { cn } from "@/lib/utils";

/** The pencil in the header: «وضع التعديل» on and off. Only the owner, signed in, ever sees it. */
export function EditToggle({ className }: { className?: string }) {
  const { canEdit, editing, setEditing } = useShell();
  if (!canEdit) return null;
  return (
    <button
      type="button"
      onClick={() => setEditing(!editing)}
      aria-pressed={editing}
      aria-label="وضع التعديل"
      title="وضع التعديل"
      className={cn("inline-flex size-9 items-center justify-center rounded-lg border", editing ? "border-accent bg-accent text-accent-fg" : "border-border text-fg-muted hover:bg-surface-2 hover:text-fg", className)}
    >
      <Pencil className="size-[18px]" />
    </button>
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
