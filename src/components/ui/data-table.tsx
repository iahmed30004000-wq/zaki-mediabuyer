import type { Key, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface Column<Row> {
  key: string;
  header: string;
  /** What the cell shows. A number goes through `Num`/`fmt`, never raw maths. */
  cell: (row: Row) => ReactNode;
  /** Numbers read left-to-right and align to the end. */
  numeric?: boolean;
  /** On a phone the column is left out of the card (it stays on the desktop table). */
  hideOnMobile?: boolean;
  className?: string;
}

/**
 * The table: header on `surface-2`, a 44px row, numbers LTR. Six columns by default — the rest live behind «أعمدة أكتر», which the
 * caller builds. On a phone every row becomes a card (label : value lines), so nothing scrolls sideways.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  label,
  empty,
  className,
}: {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => Key;
  /** Names the table for a screen reader. */
  label: string;
  /** Shown instead of the table when there are no rows (an `EmptyState`). */
  empty?: ReactNode;
  className?: string;
}) {
  if (!rows.length && empty) return <>{empty}</>;
  const mobile = columns.filter((c) => !c.hideOnMobile);
  return (
    <div className={className}>
      <div className="hidden overflow-x-auto rounded-card border border-border bg-surface-1 md:block">
        <table aria-label={label} className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2 text-fg-muted">
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("h-10 whitespace-nowrap px-3 text-start text-xs font-bold", c.numeric && "text-end", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="h-11 border-t border-border hover:bg-surface-2/60">
                {columns.map((c) => (
                  <td key={c.key} className={cn("px-3 align-middle", c.numeric && "text-end tabular-nums [direction:ltr]", c.className)}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul aria-label={label} className="space-y-3 md:hidden">
        {rows.map((row) => (
          <li key={rowKey(row)} className="space-y-1.5 rounded-card border border-border bg-surface-1 p-4">
            {mobile.map((c, i) => (
              <div key={c.key} className={cn("flex items-baseline justify-between gap-3 text-sm", i === 0 && "text-base font-extrabold")}>
                {i === 0 ? null : <span className="shrink-0 text-xs text-fg-muted">{c.header}</span>}
                <span className={cn("min-w-0", c.numeric && "tabular-nums [direction:ltr]")}>{c.cell(row)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}
