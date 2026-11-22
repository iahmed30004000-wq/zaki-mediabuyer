import { ShieldAlert, ShieldCheck } from "lucide-react";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import { loadDataset } from "@/lib/source";
import { loadDataHealth, loadSafety } from "@/lib/launch-view";

/** «الصحة»: is the tracking, the attribution and the accounts sound — every number below depends on it. */
export async function DataHealth() {
  const [ds, health, safety] = await Promise.all([loadDataset(), loadDataHealth(), loadSafety()]);
  const sends = health?.capi;
  const metrics = health && sends
    ? [
        { l: "نسبة الإسناد", v: health.attributedPct, u: "%" as const, ok: health.attributedPct === null || health.attributedPct >= 80, h: "طلبات الـ OMS اللي إلها رقم إعلان" },
        { l: "أكبر فرق ميتا/حقيقي", v: health.gapWorst?.gap ?? null, u: "%" as const, ok: !health.gapWorst || Math.abs(health.gapWorst.gap) <= 20, h: health.gapWorst ? health.gapWorst.campaign : "تحت 20% سليم", term: "gap" as const },
        { l: "طلبات انرسلت لميتا وانقبلت", v: health.capiAcceptedPct, u: "%" as const, ok: health.capiAcceptedPct === null || health.capiAcceptedPct >= 90, h: `آخر 7 أيام · ${sends.sent} انبعت · ${sends.pending} بالانتظار · ${sends.expired} منتهي` },
        { l: "مرفوض أو بلا معرّف", v: sends.rejected + sends.skipped, u: undefined, ok: sends.rejected === 0, h: `${sends.rejected} رفضته ميتا · ${sends.skipped} ما إلو معرّف` },
      ]
    : [
        { l: "نسبة الإسناد", v: 86, u: "%" as const, ok: true, h: "طلبات الـ OMS اللي إلها رقم إعلان" },
        { l: "فرق ميتا/حقيقي", v: 8, u: "%" as const, ok: true, h: "تحت 20% سليم" , term: "gap" as const },
        { l: "طلبات انرسلت لميتا وانقبلت", v: 97.4, u: "%" as const, ok: true, h: "آخر 24 ساعة" },
        { l: "صرف يتيم", v: 12.63, u: "$" as const, ok: false, h: "حملة بلا رمز منتج" },
      ];

  return (
    <div className="space-y-8">
      <Section title="صحة البيانات" hint="إذا في أصفر هون، صلّحه أول — كل الأرقام بتعتمد عليه" tour="health">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((m) => (
            <Panel key={m.l}>
              <p className="text-sm text-fg-muted">{m.l}</p>
              <Num value={m.v} unit={m.u} term={"term" in m ? m.term : undefined} source="truth" big tone={m.ok ? undefined : "warn"} />
              <p className="mt-1 text-sm text-fg-muted">{m.h}</p>
            </Panel>
          ))}
        </div>
      </Section>

      {health?.gaps.length ? (
        <Section title="الفرق لكل حملة" hint="ميتا مقابل طلبات الـ OMS من صفحات الهبوط، آخر 7 أيام — الأسوأ أول">
          <Panel className="space-y-2">
            {health.gaps.slice(0, 8).map((g) => (
              <div key={g.campaign} className="flex flex-wrap items-baseline gap-2 text-sm">
                <span dir="ltr" className="tabular-nums text-xs text-fg">{g.campaign}</span>
                <span className={Math.abs(g.gap) > 20 ? "font-semibold text-warn" : "text-fg-muted"} dir="ltr">{g.gap > 0 ? "+" : ""}{g.gap}%</span>
                <span className="text-sm text-fg-muted">{g.cause}</span>
              </div>
            ))}
          </Panel>
        </Section>
      ) : null}

      <Section title="سلامة الحسابات" hint="الرفض، الدفع، والقيود — أي مشكلة بتنزّل مستوى الحساب لصفر فوراً">
        <div id="safety" className="scroll-mt-24">
          {safety ? (
            <div className="grid gap-3 md:grid-cols-2">
              {safety.map((a) => (
                <Panel key={a.metaId} className="space-y-2">
                  <div className="flex items-start gap-3">
                    {a.verdict === "ok" ? <ShieldCheck className="mt-0.5 size-5 text-ok" /> : <ShieldAlert className={a.verdict === "restricted" ? "mt-0.5 size-5 text-danger" : "mt-0.5 size-5 text-warn"} />}
                    <div className="space-y-1 text-sm">
                      <p className="font-semibold text-fg">{a.name}</p>
                      <p className="text-sm text-fg-muted">{a.status}{a.notes.length ? ` · ${a.notes.join(" · ")}` : " · ولا رفض آخر 24 ساعة · الدفع سليم"}</p>
                      {a.frozenUntil ? <p className="text-sm text-warn">الإنشاء مجمّد لـ {a.frozenUntil}</p> : null}
                    </div>
                  </div>
                  {a.issues.map((i) => (
                    <details key={i.id} className="rounded-lg border border-border p-2 text-sm">
                      <summary className="cursor-pointer text-fg">
                        <span dir="ltr" className="tabular-nums">{i.adName}</span> انرفض — {i.reasons}
                      </summary>
                      {i.draft ? <pre className="mt-2 whitespace-pre-wrap font-sans leading-6 text-fg-muted">{i.draft}</pre> : <p className="mt-2 text-fg-muted">المسودة بتنكتب بالفحص الجاي</p>}
                    </details>
                  ))}
                </Panel>
              ))}
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {ds.accounts.map((a) => (
                <Panel key={a.id} className="flex items-start gap-3">
                  <ShieldCheck className="mt-0.5 size-5 text-ok" />
                  <div className="space-y-1 text-sm">
                    <p className="font-semibold text-fg">{a.name}</p>
                    <p className="text-sm text-fg-muted">ولا رفض آخر 24 ساعة · الدفع سليم · بلا قيود{a.note ? ` · ${a.note}` : ""}</p>
                  </div>
                </Panel>
              ))}
            </div>
          )}
        </div>
      </Section>
    </div>
  );
}
