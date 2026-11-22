import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** A titled block of a page. `tour` marks it for «فرجيني». */
export function Section({ title, hint, tour, link, children, className }: { title: string; hint?: string; tour?: string; link?: { href: string; label: string }; children: ReactNode; className?: string }) {
  return (
    <section data-tour={tour} className={cn("space-y-3", className)}>
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-fg">{title}</h2>
          {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
        </div>
        {link ? (
          <Link href={link.href} className="shrink-0 text-sm font-medium text-accent hover:underline">
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** A plain card. */
export function Panel({ children, className, id }: { children: ReactNode; className?: string; id?: string }) {
  return <div id={id} className={cn("rounded-card border border-border bg-surface-1 p-4 shadow-card", className)}>{children}</div>;
}
