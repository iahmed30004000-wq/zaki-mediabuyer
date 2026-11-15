"use client";

import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NODE_TYPES, type NodeType } from "@/core/workflow";
import { TYPE_AR } from "@/core/workflow-edit";
import { TYPE_ICON } from "./canvas";

const HINT: Record<NodeType, string> = {
  trigger: "متى بتبلّش: وقت، حدث (رقم عدّى حدّه، طلب جديد)، أو يدوي",
  step: "شغلة بتنعمل: Claude أو هيرمز أو ميوز أو شخص أو n8n",
  condition: "إذا… وإلا: بيفرّق الشغل لمسارين على رقم",
  approval: "بتوقّف الشغل لحد ما توافق إنت (أي صرف أكتر أو شي برّا القواعد)",
  wait: "بتستنى ردّ أو «خلص» من حدا، أو وقت",
  notify: "رسالة للمالك أو للفريق (اليوم · تيليجرام)",
};

/** «شو نوع الخطوة؟» — six choices, one tap each. Used by the toolbar, by a «+» on a line and by a line let go on empty floor. */
export function NodePicker({ open, title, onPick, onClose }: { open: boolean; title: string; onPick: (t: NodeType) => void; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>اختار نوع الخطوة</SheetDescription>
        </SheetHeader>
        <SheetBody>
          <ul className="space-y-2">
            {NODE_TYPES.map((t) => {
              const Icon = TYPE_ICON[t];
              return (
                <li key={t}>
                  <button type="button" onClick={() => onPick(t)} className="flex min-h-14 w-full items-center gap-3 rounded-xl border border-border bg-surface-1 px-3 text-start hover:border-accent hover:bg-surface-2">
                    <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-fg-muted">
                      <Icon className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-fg">{TYPE_AR[t]}</span>
                      <span className="block text-xs leading-5 text-fg-muted">{HINT[t]}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
