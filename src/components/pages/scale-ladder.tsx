import { Panel, Section } from "@/components/mb/section";
import { gatherScale } from "@/jobs/scale-run";
import { isDemo } from "@/core/readiness";

/** «سلّم التكبير»: every running ad set — raised or not, and why. The code decides, not an opinion. */
export async function ScaleLadder() {
  const ladder = isDemo(process.env) ? null : await gatherScale();
  return (
    <Section title="سلّم التكبير" hint="كل مجموعة شغّالة: بتنرفع ولا لأ، وليش — الكود بيقرر، مش رأي">
      {ladder?.length ? (
        <Panel className="divide-y divide-border p-0">
          {ladder.map((r) => (
            <div key={r.adSetId} className="flex flex-col gap-1 px-4 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
              <span dir="ltr" className="w-56 shrink-0 tabular-nums text-sm text-fg">{r.name}</span>
              <span dir="ltr" className="w-20 text-sm tabular-nums text-fg-muted">{r.facts.dailyBudget}{r.unit ? ` ${r.unit}` : "$"} / يوم</span>
              <span className={r.decision.raise ? "flex-1 text-sm text-ok" : "flex-1 text-sm text-fg-muted"}>{r.decision.raise ? `جاهزة: ← ${r.decision.newBudget}$` : r.decision.blockers[0]}</span>
              {r.decision.horizontal ? <span className="rounded-md bg-warn/10 px-1.5 py-0.5 text-sm font-semibold text-warn">كبّر أفقياً</span> : null}
            </div>
          ))}
        </Panel>
      ) : (
        <Panel className="text-sm text-fg-muted">{isDemo(process.env) ? "السلّم بيشتغل على أرقام حقيقية: بيبيّن هون أول ما يتربط ميتا والـ OMS (أو يبعت Claude الأرقام)." : "ما في مجموعات شغّالة لهلأ."}</Panel>
      )}
    </Section>
  );
}
