import { Check, Clock, Lock, X } from "lucide-react";
import { ROLES, ROLE_AR, ROLE_NOTE } from "@/core/roles";
import type { AgentRow, Cell, RoleRow, Section } from "@/core/permissions";
import { cn } from "@/lib/utils";

const STATE = {
  self: { word: "لحاله", Icon: Check, tone: "text-ok" },
  approval: { word: "بموافقة المالك من الموقع", Icon: Clock, tone: "text-warn" },
  no: { word: "ممنوع", Icon: X, tone: "text-fg-muted" },
} as const;

function Mark({ cell }: { cell: Cell }) {
  const s = STATE[cell.state];
  const label = [s.word, cell.basis === "instruction" ? "تعليمة للوكيل" : "", cell.note ?? ""].filter(Boolean).join(" — ");
  return (
    <span title={label} className={cn("inline-flex items-center justify-center gap-1", s.tone)}>
      <s.Icon aria-hidden className="size-4" />
      <span className="sr-only">{label}</span>
      {cell.basis === "instruction" ? <span aria-hidden className="text-sm font-bold text-fg-muted">تعليمة</span> : null}
    </span>
  );
}

function Table<R extends { key: string; label: string; locked: boolean }>({ sections, columns, cellOf, caption }: { sections: Section<R>[]; columns: { key: string; label: string; note?: string }[]; cellOf: (row: R, col: string) => Cell | undefined; caption: string }) {
  return (
    <div className="relative overflow-x-auto rounded-card border border-border bg-surface-1">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th scope="col" className="sticky start-0 z-10 w-[260px] bg-surface-2 px-3 py-2 text-start text-sm font-bold text-fg-muted">
              العمل
            </th>
            {columns.map((c) => (
              <th key={c.key} scope="col" title={c.note} className="px-2 py-2 text-center text-sm font-bold text-fg">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        {sections.map((sec) => (
          <tbody key={sec.title}>
            <tr>
              <th colSpan={columns.length + 1} scope="colgroup" className="bg-surface-2/60 px-3 py-1.5 text-start text-sm font-extrabold text-fg">
                {sec.title}
              </th>
            </tr>
            {sec.rows.map((r) => (
              <tr key={r.key} className="border-t border-border">
                <th scope="row" className="sticky start-0 z-10 bg-surface-1 px-3 py-2 text-start font-medium text-fg">
                  <span className="inline-flex items-center gap-1.5">
                    {r.locked ? <Lock aria-label="قفل: ما بيتغيّر من أي شاشة" className="size-3.5 shrink-0 text-fg-muted" /> : null}
                    {r.label}
                  </span>
                </th>
                {columns.map((c) => {
                  const cell = cellOf(r, c.key);
                  return (
                    <td key={c.key} className="px-2 py-2 text-center">
                      {cell ? <Mark cell={cell} /> : <span className="text-fg-muted">—</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

/** The people's table: the actions in three groups, a column per role. Every cell is computed from `roles.ts` — never typed by hand. */
export function RolesTable({ sections }: { sections: Section<RoleRow>[] }) {
  return <Table sections={sections} caption="مين بيقدر شو — الأدوار" columns={ROLES.map((r) => ({ key: r, label: ROLE_AR[r], note: ROLE_NOTE[r] }))} cellOf={(row, col) => (row.cells as Record<string, Cell>)[col]} />;
}

/** The agents' table: the doors their tokens open, then what each does on Meta by the account's level. */
export function AgentsTable({ sections, agents }: { sections: Section<AgentRow>[]; agents: { key: string; name: string }[] }) {
  if (!agents.length) return <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">ما في وكلاء بالدليل لسا.</p>;
  return <Table sections={sections} caption="مين بيقدر شو — الوكلاء" columns={agents.map((a) => ({ key: a.key, label: a.name }))} cellOf={(row, col) => row.cells[col]} />;
}

/** What the marks mean, once, under the tables. */
export function MatrixLegend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-fg-muted">
      <li className="inline-flex items-center gap-1"><Check aria-hidden className="size-4 text-ok" /> لحاله</li>
      <li className="inline-flex items-center gap-1"><Clock aria-hidden className="size-4 text-warn" /> بموافقة المالك من الموقع</li>
      <li className="inline-flex items-center gap-1"><X aria-hidden className="size-4" /> ممنوع</li>
      <li className="inline-flex items-center gap-1"><Lock aria-hidden className="size-3.5" /> قفل: ما بيتغيّر من أي شاشة</li>
      <li>«تعليمة»: الموقع ما بيقدر يمنع وكيل معه توكن ميتا من شي برّاه، فهي تعليمة بيلتزم فيها</li>
    </ul>
  );
}
