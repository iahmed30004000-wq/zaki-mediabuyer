import Link from "next/link";
import { Panel } from "@/components/mb/section";
import { GLOSSARY, SOURCE_AR } from "@/lib/glossary";
import { ARTICLES, PAGE_GUIDE } from "@/lib/guide";
import { PLACES } from "@/lib/nav";

/** «الدليل» — it lives in الإعدادات now; the assistant's «اشرح لي هالشاشة» opens the page's own part of it. */
export function GuideBody() {
  return (
    <div className="space-y-8">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
        <div>
          <h3 className="text-base font-bold text-fg">أهلين بالميديا باير</h3>
          <p className="mt-1 max-w-prose text-sm leading-6 text-fg-muted">
            النظام بيحسب كل رقم من الحقيقة (الـ OMS)، بيحرس صرفك لحاله، وبيستنى موافقتك على أي دولار زيادة. خمس أماكن بس، وبكل صفحة زر «؟» بيشرحها وبيفرجيك، والمساعد (الزر العائم) بيشرح أي شاشة بضغطة.
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h3 className="text-base font-bold text-fg">الأماكن الخمسة</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PLACES.map((p) => (
            <Link key={p.key} href={p.href} className="rounded-card border border-border bg-surface-1 p-4 shadow-card hover:border-accent/50">
              <p className="flex items-center gap-2 font-semibold text-fg">
                <p.icon className="size-4 text-accent" />
                {p.label}
              </p>
              <p className="mt-1 text-sm leading-5 text-fg-muted">{PAGE_GUIDE[p.key].what}</p>
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-bold text-fg">أسئلة بتتكرر</h3>
        <div className="grid gap-3 md:grid-cols-2">
          {ARTICLES.map((a) => (
            <details key={a.slug} id={a.slug} className="group rounded-card border border-border bg-surface-1 p-4 shadow-card">
              <summary className="flex min-h-10 cursor-pointer list-none items-center text-sm font-semibold text-fg group-open:text-accent max-md:min-h-[44px]">{a.title}</summary>
              {a.body.map((b, i) => (
                <p key={i} className="mt-2 text-base leading-6 text-fg">{b}</p>
              ))}
            </details>
          ))}
        </div>
      </section>

      <details className="group space-y-3 rounded-card border border-border bg-surface-1 p-4">
        <summary className="flex min-h-10 cursor-pointer list-none items-center text-base font-bold text-fg group-open:text-accent max-md:min-h-[44px]">كل رقم من وين</summary>
        <Panel className="mt-3 overflow-x-auto p-0">
          <table className="w-full min-w-[34rem] text-sm">
            <tbody className="divide-y divide-border">
              {Object.values(GLOSSARY).map((t) => (
                <tr key={t.name}>
                  <td className="px-3 py-2 font-medium text-fg">{t.name}</td>
                  <td className="px-3 py-2 text-sm text-fg-muted">{t.formula}</td>
                  <td className="px-3 py-2 text-sm text-fg-muted">{SOURCE_AR[t.source]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </details>
    </div>
  );
}
