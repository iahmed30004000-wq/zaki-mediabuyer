import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/** A folded card: a title, a one-line summary, and the editor inside. Several are on a page, none of them is long until it is opened. */
export function FoldCard({ id, title, summary, children, open = false }: { id?: string; title: string; summary: string; children: ReactNode; open?: boolean }) {
  return (
    <details id={id} open={open} className="group scroll-mt-24 rounded-card border border-border bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-extrabold text-fg">{title}</span>
          <span className="block text-sm text-fg-muted">{summary}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border p-4">{children}</div>
    </details>
  );
}
