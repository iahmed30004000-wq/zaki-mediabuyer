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
          {hint ? <p className="text-xs text-fg-muted">{hint}</p> : null}
        </div>
        {link ? (
          <Link href={link.href} className="shrink-0 text-xs font-medium text-accent hover:underline">
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

/** A thin progress bar with a cap mark. */
export function PaceBar({ value, plan, cap }: { value: number; plan: number; cap: number }) {
  const max = Math.max(cap, value) * 1.05;
  const pct = (n: number) => `${Math.min(100, (n / max) * 100)}%`;
  const tone = value >= cap ? "bg-danger" : value >= cap * 0.85 ? "bg-warn" : "bg-accent";
  return (
    <div className="relative h-2.5 rounded-full bg-surface-2" role="img" aria-label={`صرف ${value} من خطة ${plan} وسقف ${cap}`}>
      <div className={cn("absolute inset-y-0 start-0 rounded-full", tone)} style={{ width: pct(value) }} />
      <div className="absolute -inset-y-1 w-0.5 rounded bg-fg-muted/50" style={{ insetInlineStart: pct(plan) }} title="الخطة" />
      <div className="absolute -inset-y-1.5 w-0.5 rounded bg-danger" style={{ insetInlineStart: pct(cap) }} title="السقف" />
    </div>
  );
}
