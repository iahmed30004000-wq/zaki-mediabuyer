import { Card, CardBody } from "@/components/ui/card";
import { ReportBody } from "@/components/ui/report-body";
import { SectionTitle } from "@/components/ui/section-title";
import { readReportText } from "@/core/report-body";
import { isHttpsUrl } from "@/core/safe-url";
import { METRIC_AR } from "@/lib/glossary";

/**
 * A run's report, its numbers and its links, in the owner's words (docs/rebuild-v6/02-screens.md §3.6): a report the code wrote as an object is sentences and a table (`ReportBody`) — never
 * a bracket of JSON; a text is a text; a text that looks like JSON but does not read as one is folded under «نص خام». The numbers of the run are a table with the owner's names
 * (`METRIC_AR`); a key with no name is shown as it is. Links are `https://` only.
 */
export function ReportView({ text, metrics, artifacts }: { text: string | null; metrics: Record<string, unknown> | null; artifacts: { label: string; url?: string; text?: string }[] }) {
  const read = readReportText(text);
  return (
    <div className="space-y-5">
      {read.kind === "value" ? (
        <Card>
          <CardBody>
            <ReportBody report={read.value} labels={METRIC_AR} />
          </CardBody>
        </Card>
      ) : read.kind === "text" ? (
        /^[{[]/.test(read.text) ? (
          <details className="rounded-xl border border-border bg-surface-1 px-4 py-3">
            <summary className="min-h-11 cursor-pointer text-base font-semibold text-fg">نص خام</summary>
            <p dir="ltr" className="mt-2 whitespace-pre-wrap break-words text-start text-base text-fg-muted">
              {read.text}
            </p>
          </details>
        ) : (
          <Card>
            <CardBody>
              <p className="whitespace-pre-wrap text-base leading-7 text-fg">{read.text}</p>
            </CardBody>
          </Card>
        )
      ) : null}

      {metrics && Object.keys(metrics).length ? (
        <section className="space-y-2">
          <SectionTitle>أرقام التشغيل</SectionTitle>
          <ReportBody report={metrics} labels={METRIC_AR} />
        </section>
      ) : null}

      {artifacts.length ? (
        <section className="space-y-2">
          <SectionTitle>الروابط</SectionTitle>
          <ul className="m-0 list-none space-y-1.5 p-0 text-base">
            {artifacts.map((a, i) => (
              <li key={`${a.label}-${i}`}>
                {a.url && isHttpsUrl(a.url) ? (
                  <a href={a.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-info hover:underline">
                    {a.label}
                  </a>
                ) : (
                  <span className="font-semibold text-fg">{a.label}</span>
                )}
                {a.text ? <span className="text-fg-muted"> — {a.text}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
