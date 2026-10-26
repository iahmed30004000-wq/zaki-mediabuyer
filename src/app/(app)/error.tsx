"use client";

import { Button } from "@/components/ui/button";

/** A screen that failed says what to do, not a stack trace. */
export default function PlaceError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-3 rounded-card border border-border bg-surface-1 p-5 text-center shadow-card">
      <p className="text-lg font-bold text-fg">صار خطأ بهالصفحة</p>
      <p className="text-sm text-fg-muted">الأرقام والقواعد شغّالة بالخلفية. جرّب كمان مرة، وإذا ضل، شوف «التقارير ← صحة البيانات».</p>
      <Button onClick={reset}>جرّب كمان مرة</Button>
    </div>
  );
}
