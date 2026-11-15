import { PrintButton } from "@/components/numbers/print-button";
import { lineTime, type DayGroup } from "@/core/day";
import { loadDay, readDay } from "@/lib/day-view";

export const metadata = { title: "الإنجاز — للطباعة" };
export const dynamic = "force-dynamic";

function Section({ title, groups }: { title: string; groups: DayGroup[] }) {
  return (
    <section className="space-y-3 border-t border-neutral-300 pt-4">
      <h2 className="text-base font-bold">{title}</h2>
      {groups.map((g) => (
        <table key={g.key} className="w-full break-inside-avoid text-sm">
          <thead>
            <tr>
              <th colSpan={3} className="pb-1 text-start text-xs font-semibold text-neutral-600">{g.label} ({g.items.length})</th>
            </tr>
          </thead>
          <tbody>
            {g.items.map((i, n) => (
              <tr key={`${i.at}-${n}`} className="border-b border-neutral-200 align-top">
                <td dir="ltr" className="w-14 py-1 font-mono text-xs text-neutral-600">{lineTime(i)}</td>
                <td className={`py-1 ${i.tone === "danger" ? "font-semibold" : ""}`}>{i.text}</td>
                <td dir="ltr" className="py-1 text-end text-xs tabular-nums text-neutral-600">{i.numbers?.join(" · ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ))}
    </section>
  );
}

/** The day laid out for paper and for «حفظ كـ PDF» on a phone: light, plain, one person after another. A session is required. */
export default async function PrintDayPage({ searchParams }: { searchParams: { day?: string } }) {
  const data = await loadDay(readDay(searchParams.day));
  const at = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return (
    <main style={{ colorScheme: "light" }} className="mx-auto min-h-dvh max-w-3xl space-y-5 bg-white p-5 text-black print:max-w-none print:p-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الميديا باير — الإنجاز</h1>
          <p className="text-sm text-neutral-600">{data.title} · انطبعت {at}{data.demo ? " · بيانات تجريبية" : ""}</p>
        </div>
        <PrintButton />
      </header>
      {data.state !== "future" ? (data.done.length ? <Section title="اللي انعمل" groups={data.done} /> : <p className="border-t border-neutral-300 pt-4 text-sm text-neutral-600">ما في إنجاز مسجّل لهاليوم.</p>) : null}
      {data.state !== "past" ? (data.planned.length ? <Section title={data.state === "today" ? "لسا اليوم" : "المخطّط"} groups={data.planned} /> : <p className="border-t border-neutral-300 pt-4 text-sm text-neutral-600">ما في شي مجدول.</p>) : null}
      <p className="border-t border-neutral-300 pt-3 text-[11px] text-neutral-500">كل سطر مكتوب بالكود من تشغيلات وقرارات ومهام انسجّلت — ما حدا بيكتب اليوم بإيده. الأوقات بتوقيت عمّان.</p>
    </main>
  );
}
