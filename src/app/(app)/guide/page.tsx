import Link from "next/link";
import { ArtSlot } from "@/components/theme/art-slot";
import { Panel } from "@/components/mb/section";
import { GLOSSARY, SOURCE_AR } from "@/lib/glossary";
import { ARTICLES, PAGE_GUIDE } from "@/lib/guide";
import { PLACES } from "@/lib/nav";

export const metadata = { title: "الدليل" };

/** «الدليل»: the five places in one line each, the short articles, and every number's formula in one table. */
export default function GuidePage() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <ArtSlot slot="guide-welcome" className="max-h-40 w-auto rounded-2xl" />
        <div>
          <h2 className="text-xl font-bold text-fg">أهلين بالميديا باير</h2>
          <p className="mt-1 max-w-prose text-sm leading-6 text-fg-muted">
            النظام بيحسب كل رقم من الحقيقة (الـ OMS)، بيحرس صرفك لحاله، وبيستنى موافقتك على أي دولار زيادة. خمس أماكن بس، وكل صفحة فيها زر «؟» بيشرحها وبيفرجيك.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-fg">الأماكن الخمسة</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLACES.map((p) => (
            <Link key={p.key} href={p.href} className="rounded-card border border-border bg-surface-1 p-4 shadow-card hover:border-accent/50">
              <p className="flex items-center gap-2 font-semibold text-fg">
                <p.icon className="size-4 text-accent" />
                {p.label}
              </p>
              <p className="mt-1 text-xs leading-5 text-fg-muted">{PAGE_GUIDE[p.key].what}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-fg">أسئلة بتتكرر</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {ARTICLES.map((a) => (
            <details key={a.slug} id={a.slug} className="group rounded-card border border-border bg-surface-1 p-4 shadow-card">
              <summary className="cursor-pointer list-none text-sm font-semibold text-fg group-open:text-accent">{a.title}</summary>
              {a.art ? <ArtSlot slot={a.art} className="mt-3 max-h-40 w-auto rounded-xl" /> : null}
              {a.body.map((b, i) => (
                <p key={i} className="mt-2 text-sm leading-6 text-fg">{b}</p>
              ))}
            </details>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-bold text-fg">كل رقم من وين</h2>
        <Panel className="overflow-x-auto p-0">
          <table className="w-full min-w-[34rem] text-sm">
            <tbody className="divide-y divide-border">
              {Object.values(GLOSSARY).map((t) => (
                <tr key={t.name}>
                  <td className="px-3 py-2 font-medium text-fg">{t.name}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">{t.formula}</td>
                  <td className="px-3 py-2 text-xs text-fg-muted">{SOURCE_AR[t.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </section>
    </div>
  );
}
