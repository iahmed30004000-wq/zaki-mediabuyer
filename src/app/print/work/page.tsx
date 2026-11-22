import { PrintButton } from "@/components/numbers/print-button";
import { DOMAIN_AR } from "@/core/jobs";
import { loadJobs } from "@/lib/jobs-view";
import { requirePage } from "@/server/auth";

export const metadata = { title: "خريطة المهام — للطباعة" };
export const dynamic = "force-dynamic";

/** The map of the scheduled jobs on paper (A4, white, plain): the counters, then each domain as a table — number, job, when, state, branches. A session is required. */
export default async function PrintWorkPage() {
  await requirePage("work.view");
  const { jobs, counters, demo } = await loadJobs();
  const at = new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return (
    <main style={{ colorScheme: "light" }} className="mx-auto min-h-dvh max-w-3xl space-y-5 bg-white p-5 text-black print:max-w-none print:p-0">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">الميديا باير — خريطة المهام المجدولة</h1>
          <p className="text-sm text-neutral-600">
            انطبعت {at}
            {demo ? " · بيانات تجريبية" : ""}
          </p>
        </div>
        <PrintButton />
      </header>
      <p className="text-sm">
        {counters.total} مهمة · شغّالة {counters.running} · مشكلة {counters.problem} · جاية {counters.upcoming} · عند الطلب {counters.manual} · موقوفة أو خلصت {counters.off}
      </p>
      {(["ads", "ops"] as const).map((d) => {
        const list = jobs.filter((j) => j.domain === d);
        if (!list.length) return null;
        return (
          <section key={d} className="break-inside-avoid-page space-y-2 border-t border-neutral-300 pt-4">
            <h2 className="text-base font-bold">
              {DOMAIN_AR[d]} ({list.length})
            </h2>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-400 text-start text-xs text-neutral-600">
                  <th className="w-8 py-1 text-start">#</th>
                  <th className="py-1 text-start">المهمة</th>
                  <th className="py-1 text-start">الموعد</th>
                  <th className="w-24 py-1 text-start">الوضع</th>
                </tr>
              </thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.key} className="break-inside-avoid border-b border-neutral-200 align-top">
                    <td dir="ltr" className="py-1.5 font-bold tabular-nums">
                      {j.number ?? "·"}
                    </td>
                    <td className="py-1.5">
                      <span className="font-semibold">{j.name}</span>
                      {j.branches.length ? (
                        <span className="mt-0.5 block text-xs text-neutral-600">
                          {j.branches.map((b) => `${b.number ?? ""} ${b.label}${b.disabled ? " (مطفي)" : ""}`.trim()).join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-1.5 text-xs">
                      {j.words} · {j.runner}
                    </td>
                    <td className="py-1.5 text-xs font-semibold">{j.badge.label}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      <p className="border-t border-neutral-300 pt-3 text-xs text-neutral-500">الأوقات بتوقيت عمّان. الأرقام ثابتة: بيها بتحكي مع Claude («ألغي 7 و11.3»).</p>
    </main>
  );
}
