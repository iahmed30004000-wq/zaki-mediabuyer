import { describeReport, isEmptyDoc, type DescribeOptions, type ReportDoc } from "@/core/report-body";
import { cn } from "@/lib/utils";
import { FactsTable } from "./facts-table";

function Doc({ doc, depth }: { doc: ReportDoc; depth: number }) {
  return (
    <div className="space-y-4">
      {doc.facts.length ? <FactsTable showEmpty facts={doc.facts.map((f, i) => ({ label: f.label || `#${i + 1}`, value: f.value }))} /> : null}
      {doc.tables.map((t) => (
        <section key={t.title} className="space-y-2">
          <h4 className="font-display text-base font-bold text-fg">{t.title}</h4>
          <div className="overflow-x-auto rounded-xl border border-border bg-surface-1">
            <table aria-label={t.title} className="w-full border-collapse text-base">
              <thead>
                <tr className="bg-surface-2 text-fg-muted">
                  {t.columns.map((c) => (
                    <th key={c} scope="col" className="h-11 whitespace-nowrap px-3 text-start text-sm font-bold">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.rows.map((row, r) => (
                  <tr key={r} className="h-12 border-t border-border">
                    {row.map((cell, c) => (
                      <td key={c} className="px-3 align-middle">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {t.more ? <p className="text-sm text-fg-muted">و {t.more} كمان</p> : null}
        </section>
      ))}
      {doc.sections.map((s) => (
        <section key={s.title} className="space-y-2">
          {depth === 0 ? <h3 className="font-display text-lg font-bold text-fg">{s.title}</h3> : <h4 className="font-display text-base font-bold text-fg">{s.title}</h4>}
          <Doc doc={s.doc} depth={depth + 1} />
        </section>
      ))}
    </div>
  );
}

/**
 * A report of the code (an object) as sentences and a table — never JSON (docs/rebuild-v6/03-look.md §7). `labels` gives the owner's word for a key. An empty report
 * says so in a sentence. The writing is `core/report-body.ts`; this only lays it out.
 */
export function ReportBody({ report, labels, maxRows, empty = "ما في تفاصيل", className }: { report: unknown; labels?: DescribeOptions["labels"]; maxRows?: number; empty?: string; className?: string }) {
  const doc = describeReport(report, { ...(labels ? { labels } : {}), ...(maxRows ? { maxRows } : {}) });
  return <div className={cn(className)}>{isEmptyDoc(doc) ? <p className="text-base text-fg-muted">{empty}</p> : <Doc doc={doc} depth={0} />}</div>;
}
