import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Tabs, type TabItem } from "./tabs";

/**
 * Every page starts here: the title (20/800 with the gold line under it), an optional one-line lead, the action at the end,
 * the place's tabs, then the content. Between the header and the first content there is ONE control row at most (03 §7 rule 1).
 */
export function PageShell({ title, lead, actions, tabs, children, className }: { title: string; lead?: string; actions?: ReactNode; tabs?: readonly TabItem[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-5 md:space-y-6", className)}>
      <header className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="inline-block border-b-[3px] border-accent-2 pb-1 text-xl font-extrabold text-fg">{title}</h1>
            {lead ? <p className="mt-1.5 text-sm text-fg-muted">{lead}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
        {tabs?.length ? <Tabs items={tabs} /> : null}
      </header>
      {children}
    </div>
  );
}
