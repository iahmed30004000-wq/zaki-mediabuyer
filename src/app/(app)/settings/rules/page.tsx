import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { LevelStars } from "@/components/mb/level-stars";
import { Panel } from "@/components/mb/section";
import { CapsEditor } from "@/components/settings/editors";
import { LevelPicker } from "@/components/settings/level-picker";
import { ModeSettings } from "@/components/settings/mode-settings";
import { RulesEditor } from "@/components/settings/rules-editor";
import { OrdersSection } from "@/components/work/orders-section";
import { Pill } from "@/components/ui/pill";
import { DOMAIN_AR, EFFECT_AR, untilWords, type OrderDomain } from "@/core/orders";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { loadEditView, loadSettingsView } from "@/lib/settings-view";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller } from "@/server/auth";
import { db } from "@/server/db";
import { currentMode } from "@/server/mode";
import { listOrders } from "@/server/orders";
import { getRules } from "@/server/rules";

export const metadata = { title: "القواعد" };
export const dynamic = "force-dynamic";

/** A folded card: a one-line summary, and the editor inside. Several are open at once, none is long. */
function RuleCard({ id, title, summary, children }: { id: string; title: string; summary: string; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-24 rounded-card border border-border bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
        <span className="min-w-0 flex-1">
          <span className="block text-base font-extrabold text-fg">{title}</span>
          <span className="block text-sm text-fg-muted">{summary}</span>
        </span>
        <ChevronDown className="size-5 shrink-0 text-fg-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border p-4">{children}</div>
    </details>
  );
}

/**
 * الإعدادات ← القواعد: every rule in a folded card with its one-line summary — the caps and the budget split, each account's level, the campaign
 * rules, the awake / asleep hours — and the archive of the standing orders. The editors are the ones that already existed, moved here whole.
 */
export default async function RulesPage() {
  const [real, edit, me, rulesView, mode, wf, productRows, archive, active] = await Promise.all([
    loadSettingsView(),
    loadEditView(),
    currentCaller(),
    getRules(),
    currentMode(),
    loadWorkflowCards(),
    db.productEconomics.findMany({ select: { productCode: true }, orderBy: { productCode: "asc" } }),
    listOrders({ archive: true, limit: 200 }),
    listOrders({}),
  ]);
  const demo = isDemo(process.env);
  const owner = !!me && !me.demo && can(me.role, "owner_only");
  const ended = archive.filter((o) => o.status === "ended" || o.status === "rejected");
  return (
    <div className="space-y-4">
      <RuleCard id="money" title="السقوف وتوزيع الميزانية" summary="ولا دولار فوق السقف، ولا حملة جديدة بلا سقف معروف">
        {edit ? <CapsEditor accounts={edit.accounts} split={edit.split} /> : <p className="text-sm text-fg-muted">السقوف بتنكتب لما يشتغل الموقع على البيانات الحقيقية.</p>}
      </RuleCard>

      <RuleCard id="rules" title="مستوى كل حساب" summary={real ? `${real.levels.length} حساب · البداية ★ لكل الحسابات` : "★ لكل الحسابات"}>
        <div className="grid gap-3 md:grid-cols-2">
          {real?.levels.length ? (
            real.levels.map((a) => (
              <Panel key={a.metaId} className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-fg">{a.name}</p>
                  <LevelStars level={a.level as 0 | 1 | 2 | 3} />
                </div>
                <LevelPicker row={a} />
              </Panel>
            ))
          ) : (
            <p className="text-sm text-fg-muted">ما في حسابات مربوطة لسا.</p>
          )}
        </div>
      </RuleCard>

      <RuleCard id="campaign-rules" title="أحكام الحملات" summary={`النسخة ${rulesView.version} · بتتحفظ بنسخ وClaude بيقراها بكل تشغيل`}>
        <RulesEditor initial={rulesView.rules} version={rulesView.version} products={productRows.map((p) => p.productCode)} demo={demo} />
      </RuleCard>

      <RuleCard id="mode" title="صاحي ونايم" summary="جدول الليل، وشو بيشتغل وإنت نايم، وشو بيصحّيك">
        <ModeSettings schedule={mode.schedule} night={mode.nightPermissions} wakeKinds={mode.wakeKinds} workflows={wf.cards.map((c) => ({ key: c.key, name: c.name }))} demo={demo} />
      </RuleCard>

      <RuleCard id="orders" title="الأوامر السارية" summary={`${active.filter((o) => o.status === "active").length} فعّال · ${ended.length} بالأرشيف`}>
        <OrdersSection orders={active} scope={{ domain: "all" }} title="الفعّالة" canCreate={!!me && !me.demo && can(me.role, "propose_change")} canEnd={owner} />
        <div className="space-y-2">
          <h3 className="text-base font-extrabold text-fg">الأرشيف</h3>
          {ended.length ? (
            <ul className="divide-y divide-border rounded-card border border-border">
              {ended.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                  <Pill tone="neutral">{o.status === "rejected" ? "انرفض" : "انتهى"}</Pill>
                  <span className="min-w-0 flex-1 text-fg">{o.text}</span>
                  <span className="text-xs text-fg-muted">
                    {EFFECT_AR[o.effect]} · {DOMAIN_AR[o.domain as OrderDomain] ?? o.domain} · {o.endedBy ? `${untilWords(o.endsAt)} · ${o.endedBy === "system" ? "انتهى لحاله" : "إنت"}` : untilWords(o.endsAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-fg-muted">ما في أوامر منتهية لسا.</p>
          )}
        </div>
      </RuleCard>

      <p className="text-sm text-fg-muted">
        <Link href="/settings" className="font-semibold text-info hover:underline">
          ← الإعدادات
        </Link>
      </p>
    </div>
  );
}
