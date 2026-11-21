import Link from "next/link";
import { Panel } from "@/components/mb/section";
import { loadAudit } from "@/lib/settings-view";
import { cn } from "@/lib/utils";
import { requirePage } from "@/server/auth";

export const metadata = { title: "السجل" };
export const dynamic = "force-dynamic";

const FILTERS = [
  { k: "", l: "الكل" },
  { k: "user", l: "ناس" },
  { k: "rule", l: "قواعد" },
  { k: "agent", l: "وكلاء" },
  { k: "system", l: "النظام" },
];

/** الإعدادات ← متقدّم ← السجل: مين عمل شو ومتى — إنسان أو قاعدة أو وكيل أو النظام. ما بينحذف منه شي، وما فيه سرّ ولا بيانات زبون. */
export default async function LogPage({ searchParams }: { searchParams: { audit?: string } }) {
  await requirePage("settings.view");
  const actor = ["user", "rule", "agent", "system"].includes(searchParams.audit ?? "") ? searchParams.audit : undefined;
  const audit = await loadAudit({ actor, take: 25 });
  if (!audit) return <Panel className="text-sm text-fg-muted">السجل بيبيّن لما يشتغل الموقع على البيانات الحقيقية (مش التجريبية).</Panel>;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link key={f.k} href={f.k ? `/settings/advanced/log?audit=${f.k}` : "/settings/advanced/log"} className={cn("inline-flex min-h-10 max-md:min-h-[44px] items-center rounded-full border px-4", (actor ?? "") === f.k ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>
            {f.l}
          </Link>
        ))}
      </div>
      <p className="text-sm text-fg-muted">آخر 25 حدث.</p>
      <Panel className="divide-y divide-border p-0">
        {audit.length ? (
          audit.map((a) => (
            <div key={a.id} className="space-y-0.5 px-4 py-2 text-sm">
              <p className="text-fg">
                <span className="font-medium">{a.who}</span> · {a.action} <span dir="ltr" className="font-mono text-xs text-fg-muted">{a.target}</span> <span className="text-xs text-fg-muted">· {a.at}</span>
              </p>
              {a.change ? <p dir="ltr" className="truncate text-start font-mono text-xs text-fg-muted">{a.change}</p> : null}
            </div>
          ))
        ) : (
          <p className="px-4 py-3 text-sm text-fg-muted">ما في شي بالسجل لهالفلتر</p>
        )}
      </Panel>
    </div>
  );
}
