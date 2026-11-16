import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Fact {
  label: string;
  /** null, undefined or "" = the fact is not known. */
  value: ReactNode | null | undefined;
}

const isEmpty = (v: ReactNode | null | undefined) => v === null || v === undefined || v === "" || v === false;

/**
 * A label · value table («البرنامج · الموعد · من وين بيجي»). A fact with no value is NOT shown (no empty field, 04 §3), unless
 * `showEmpty` asks for «—» (a table where the gap itself is information).
 */
export function FactsTable({ facts, showEmpty = false, className }: { facts: readonly Fact[]; showEmpty?: boolean; className?: string }) {
  const rows = showEmpty ? facts : facts.filter((f) => !isEmpty(f.value));
  if (!rows.length) return null;
  return (
    <dl className={cn("divide-y divide-border rounded-card border border-border bg-surface-1", className)}>
      {rows.map((f) => (
        <div key={f.label} className="flex items-baseline justify-between gap-4 px-4 py-2.5 text-sm">
          <dt className="shrink-0 text-fg-muted">{f.label}</dt>
          <dd className="min-w-0 text-end font-semibold text-fg">{isEmpty(f.value) ? "—" : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}
