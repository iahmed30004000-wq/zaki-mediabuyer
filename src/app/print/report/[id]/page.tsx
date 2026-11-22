import { notFound } from "next/navigation";
import { PrintButton } from "@/components/numbers/print-button";
import { getReport } from "@/server/reports";
import { requirePage } from "@/server/auth";
import { Table } from "@/components/ui/table";

export const metadata = { title: "تقرير — للطباعة" };
export const dynamic = "force-dynamic";

/** One report on paper (A4, white, plain): the title and time, the line, the full text, the run's numbers. A session is required. */
export default async function PrintReportPage({ params: paramsP }: { params: Promise<{ id: string }> }) {
  await requirePage("work.view");
  const params = await paramsP;
  const r = await getReport(decodeURIComponent(params.id));
  if (!r) notFound();
  const at = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", dateStyle: "full", timeStyle: "short" }).format(new Date(r.at));
  return (
    <main style={{ colorScheme: "light" }} className="mx-auto min-h-dvh max-w-3xl space-y-5 bg-white p-5 text-black print:max-w-none print:p-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">
            {r.jobNumber ? `${r.jobNumber} · ` : ""}
            {r.title}
          </h1>
          <p className="text-sm text-neutral-600">{at}</p>
        </div>
        <PrintButton />
      </header>
      {r.summary ? <p className="border-t border-neutral-300 pt-3 text-base font-semibold">{r.summary}</p> : null}
      {r.text ? <p className="whitespace-pre-wrap border-t border-neutral-300 pt-3 text-sm leading-7">{r.text}</p> : null}
      {r.metrics.length ? (
        <Table aria-label="التقرير" className="w-full border-t border-neutral-300 text-sm">
          <tbody>
            {r.metrics.map((m) => (
              <tr key={m.label} className="border-b border-neutral-200">
                <td className="py-1 text-neutral-600">{m.label}</td>
                <td dir="ltr" className="py-1 text-end font-semibold tabular-nums">
                  {m.value}
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : null}
      <p className="border-t border-neutral-300 pt-3 text-sm text-neutral-500">الأوقات بتوقيت عمّان.</p>
    </main>
  );
}
