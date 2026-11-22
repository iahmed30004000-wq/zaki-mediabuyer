import { cn } from "@/lib/utils";
import { ButtonLink } from "./button-link";

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("rounded-card border border-border bg-surface-1 shadow-card", className)}>{children}</div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("border-b border-border px-4 py-3", className)}>{children}</div>;
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}

export function Badge({
  children,
  color,
  className,
}: {
  children: React.ReactNode;
  color?: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-border bg-surface-2 px-2 py-0.5 text-xs font-semibold text-fg-muted",
        className,
      )}
    >
      {color ? <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} /> : null}
      {children}
    </span>
  );
}

/**
 * What a list says when it has nothing in it — and what to do about it: no dead ends, every empty page says the next step (`action`).
 * No decoration (docs/rebuild/03-look.md §1). `art` is still accepted so old callers compile; it draws nothing.
 */
export function EmptyState({
  title,
  hint,
  children,
  action,
}: {
  title: string;
  hint?: string;
  children?: React.ReactNode;
  /** Ignored (the decoration was retired); kept so old callers compile until P12. */
  art?: string;
  /** The next step, as a button link. */
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-border p-8 text-center">
      <p className="text-base font-bold text-fg">{title}</p>
      {hint ? <p className="text-sm text-fg-muted">{hint}</p> : null}
      {children}
      {action ? (
        <ButtonLink href={action.href} className="mt-2">
          {action.label}
        </ButtonLink>
      ) : null}
    </div>
  );
}
