import { PrintButton } from "@/components/numbers/print-button";
import { GROUPS, STATS, formatStat, type NumbersSet } from "@/core/numbers";
import { stampOf } from "@/core/freshness";
import { loadNumbers } from "@/lib/numbers-view";
import { loadSourceFacts } from "@/lib/source-facts";
import { requirePage } from "@/server/auth";
import { Table as KitTable } from "@/components/ui/table";

export const metadata = { title: "أرقام اليوم — للطباعة" };
export const dynamic = "force-dynamic";

function Table({ title, set, extra }: { title: string; set: NumbersSet; extra?: string }) {
  return (
    <section className="break-inside-avoid space-y-2 border-t border-neutral-300 pt-4">
      <h2 className="text-base font-bold">{title}</h2>
      {extra ? <p className="text-sm text-neutral-600">{extra}</p> : null}
      <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {GROUPS.map((g) => (
          <KitTable key={g.key} aria-label="الأرقام" className="w-full text-sm">
            <thead>
              <tr>
                <th colSpan={2} className="pb-1 text-start text-sm font-semibold text-neutral-600">{g.label}</th>
              </tr>
            </thead>
            <tbody>
              {STATS.filter((s) => s.group === g.key).map((s) => (
                <tr key={s.key} className="border-b border-neutral-200">
                  <td className="py-0.5">{s.label}</td>
                  <td dir="ltr" className="py-0.5 text-end font-semibold tabular-nums">{formatStat(s, set[s.key])}</td>
                </tr>
              ))}
            </tbody>
          </KitTable>
        ))}
      </div>
    </section>
  );
}

/** The day, laid out for paper and for «حفظ كـ PDF» on a phone: light, plain, one product after another. A session is required. */
export default async function PrintNumbersPage({ searchParams: searchParamsP }: { searchParams: Promise<{ d?: string; from?: string; to?: string }> }) {
  await requirePage("money.view");
  const searchParams = await searchParamsP;
  const data = await loadNumbers(searchParams);
  // R-23: the page says whether its figures are «حقيقي» or «تقدير»
  const stamp = stampOf(await loadSourceFacts({ products: data.products }));
  const at = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return (
    <main style={{ colorScheme: "light" }} className="mx-auto min-h-dvh max-w-3xl space-y-5 bg-white p-5 text-black print:max-w-none print:p-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الميديا باير — الأرقام</h1>
          <p className="text-sm text-neutral-600">{data.label} · انطبعت {at}{data.demo ? " · بيانات تجريبية" : ""}</p>
          <p className="text-sm font-semibold text-neutral-800">المصدر: {stamp}</p>
        </div>
        <PrintButton />
      </header>
      <Table title="الإجمالي" set={data.totals.current} />
      {data.products.map((p) => (
        <Table key={p.code} title={`${p.name} (${p.code})`} set={p.current} extra={p.rejectReasons.length ? `أسباب الرفض: ${p.rejectReasons.map((r) => `${r.reason} (${r.count})`).join("، ")}` : undefined} />
      ))}
      <p className="border-t border-neutral-300 pt-3 text-sm text-neutral-500">كل رقم محسوب بالكود من أرقام ميتا والـ OMS. الصرف = صرف ميتا + رسوم البطاقة 1%. الإيراد المتوقع = مجموع قيمة الشحنات × نسبة التوصيل آخر 30 يوم.</p>
    </main>
  );
}
