import Link from "next/link";
import { ArrowLeft, CircleDot } from "lucide-react";
import { ThemePicker } from "@/components/theme/theme-picker";
import { LevelStars } from "@/components/mb/level-stars";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import { StudioLink } from "@/components/settings/studio-link";
import { LevelPicker } from "@/components/settings/level-picker";
import { loadAudit, loadEditView, loadSettingsView } from "@/lib/settings-view";
import { CapsEditor, LandingEditor, PagesEditor, ProductsEditor, PurchaseOnPicker, TeamPanel } from "@/components/settings/editors";
import { currentCaller } from "@/server/auth";
import { ImportPanel } from "@/components/settings/import-panel";
import { fmt } from "@/lib/format";
import { ACCOUNTS, LEVEL_AR, LEVEL_HINT, PACE, PRODUCTS, SOURCES, targetsOf } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

export const metadata = { title: "الإعدادات" };

const GROUPS = [
  { id: "connections", label: "الربط" },
  { id: "money", label: "المال والسقوف" },
  { id: "products", label: "المنتجات والصفحات" },
  { id: "rules", label: "القواعد والمستويات" },
  { id: "agents", label: "الوكلاء" },
  { id: "import", label: "الاستيراد والتصدير" },
  { id: "team", label: "الفريق والتدقيق" },
  { id: "look", label: "المظهر" },
];

const AGENTS = [
  { code: "M11", name: "كاتب التقارير", model: "داخلي · qwen3:4b", cap: 0.5 },
  { code: "M02", name: "المحلل اليومي", model: "داخلي · qwen2.5:7b", cap: 3 },
  { code: "M03", name: "المخطط", model: "قوي", cap: 3 },
  { code: "M07", name: "كاتب الإعلانات", model: "قوي", cap: 2 },
  { code: "M10", name: "الاستشاري", model: "قوي", cap: 5 },
  { code: "H01", name: "محلل الأسماء", model: "داخلي فقط (خصوصية)", cap: 0 },
];

/** Everything set once and forgotten (S02 S12 S09 S13 S16 S17 S18), grouped, one anchor per group. */
export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: { audit?: string } }) {
  const actor = ["user", "rule", "agent", "system"].includes(searchParams.audit ?? "") ? searchParams.audit : undefined;
  const [real, edit, audit, me] = await Promise.all([loadSettingsView(), loadEditView(), loadAudit({ actor }), currentCaller()]);
  return (
    <div className="space-y-8">
      <nav data-tour="groups" aria-label="مجموعات الإعدادات" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {GROUPS.map((g) => (
          <a key={g.id} href={`#${g.id}`} className="shrink-0 rounded-full border border-border bg-surface-1 px-3 py-1.5 text-xs text-fg hover:border-accent/50">
            {g.label}
          </a>
        ))}
      </nav>

      <Section title="الربط" hint="المفاتيح بملف .env على الجهاز بس — ولا مرة بالموقع ولا بالمحادثة">
        <div id="connections" className="grid scroll-mt-24 gap-3 md:grid-cols-2">
          {(edit?.links ?? SOURCES).map((s) => (
            <Panel key={s.key} className="flex items-center gap-3">
              <CircleDot className={cn("size-4", s.state === "ok" ? "text-ok" : s.state === "late" ? "text-warn" : "text-fg-muted")} />
              <div className="flex-1">
                <p className="text-sm font-semibold text-fg">{s.label}</p>
                <p className="text-xs text-fg-muted">{s.detail}</p>
              </div>
              {s.state === "off" ? (
                <Link href="/setup" className="inline-flex items-center gap-1 text-xs font-medium text-accent">
                  اربط <ArrowLeft className="size-3.5" />
                </Link>
              ) : null}
            </Panel>
          ))}
          {edit ? (
            <Panel className="space-y-1">
              <p className="text-sm font-semibold text-fg">الكتابة على ميتا</p>
              <p className={cn("text-xs", edit.writeMode === "live" ? "text-warn" : "text-fg-muted")}>{edit.writeMode === "live" ? "حقيقية — كل قرار بيوصل لميتا" : "تجريبية — كل قرار بيسجّل شو كان رح يبعت وما بيبعت. بتصير حقيقية بعد فحص الحساب التجريبي"}</p>
            </Panel>
          ) : null}
          {edit ? <PurchaseOnPicker value={edit.purchaseOn} /> : null}
          <StudioLink />
        </div>
      </Section>

      <Section title="المال والسقوف" hint="ولا دولار فوق السقف، ولا حملة جديدة بلا سقف معروف">
        {edit ? (
          <div id="money" className="scroll-mt-24">
            <CapsEditor accounts={edit.accounts} split={edit.split} />
          </div>
        ) : (
          <div id="money" className="grid scroll-mt-24 gap-3 md:grid-cols-3">
            <Panel>
              <p className="text-xs text-fg-muted">السقف اليومي (كل الحسابات)</p>
              <p dir="ltr" className="text-end text-xl font-semibold tabular-nums text-fg">{fmt(PACE.dailyCap, "$", 0)}</p>
            </Panel>
            <Panel>
              <p className="text-xs text-fg-muted">السقف الشهري</p>
              <p dir="ltr" className="text-end text-xl font-semibold tabular-nums text-fg">{fmt(PACE.monthlyCap, "$", 0)}</p>
            </Panel>
            <Panel>
              <p className="text-xs text-fg-muted">التوزيع</p>
              <p className="text-sm text-fg">70% تكبير · 20% اختبار · 10% جديد</p>
            </Panel>
          </div>
        )}
      </Section>

      <Section title="المنتجات والصفحات" hint="أرقام الحاسبة — بتنسحب من الـ OMS لما ينربط، ولحد هداك بتنحط هون">
        {edit ? (
          <div id="products" className="scroll-mt-24 space-y-4">
            <ProductsEditor products={edit.products} />
            <div className="grid gap-3 lg:grid-cols-2">
              <PagesEditor pages={edit.pages} />
              <LandingEditor landing={edit.landing} products={edit.products} />
            </div>
          </div>
        ) : (
        <Panel id="products" className="scroll-mt-24 overflow-x-auto p-0">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-surface-2 text-xs text-fg-muted">
                <tr>
                  {["المنتج", "السعر", "تكلفة الوحدة", "التوصيل", "المرتجع", "هدف الطلب"].map((h) => (
                    <th key={h} className="px-3 py-2 text-start font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PRODUCTS.map((p) => {
                  const t = targetsOf(p);
                  return (
                    <tr key={p.code}>
                      <td className="px-3 py-2 text-fg">{p.name} <span dir="ltr" className="font-mono text-xs text-fg-muted">{p.code}</span></td>
                      {[p.price, p.unitCost, p.delivery, p.returnFee].map((n, i) => (
                        <td key={i} dir="ltr" className="px-3 py-2 text-end tabular-nums text-fg">{fmt(n, "$")}</td>
                      ))}
                      <td className="px-3 py-2"><Num value={t.tOrder} unit="$" term="tOrder" source={t.estimated ? "estimate" : "truth"} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        )}
      </Section>

      <Section title="القواعد والمستويات" hint="البداية ★ لكل الحسابات · ★★ بعد أسبوعين مراجعة · ★★★ مطفي">
        <div id="rules" className="grid scroll-mt-24 gap-3 md:grid-cols-2">
          {real
            ? real.levels.map((a) => (
                <Panel key={a.metaId} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-fg">{a.name}</p>
                    <LevelStars level={a.level as 0 | 1 | 2 | 3} />
                  </div>
                  <LevelPicker row={a} />
                </Panel>
              ))
            : ACCOUNTS.map((a) => (
                <Panel key={a.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-fg">{a.name}</p>
                    <LevelStars level={a.level} />
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    {LEVEL_AR.map((l, i) => (
                      <span key={l} title={LEVEL_HINT[i]} className={cn("rounded-md py-1 text-center text-[11px]", i === a.level ? "bg-accent text-accent-fg" : i === 3 ? "bg-surface-2 text-fg-muted/60 line-through" : "bg-surface-2 text-fg-muted")}>
                        {l}
                      </span>
                    ))}
                  </div>
                  <p className="text-xs text-fg-muted">{LEVEL_HINT[a.level]}</p>
                </Panel>
              ))}
        </div>
      </Section>

      <Section title="الوكلاء" hint="بيفسّروا وبيكتبوا بس — ما حدا منهم بيلمس ميتا ولا بيشوف بيانات زبون">
        <Panel id="agents" className="scroll-mt-24 divide-y divide-border p-0">
          {real ? (
            <>
              {real.agents.map((a) => (
                <div key={a.code} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span dir="ltr" className="w-10 font-mono text-xs text-fg-muted">{a.code}</span>
                  <span className="flex-1 text-fg">{a.name}</span>
                  <span className="text-xs text-fg-muted">{a.internalOnly ? "داخلي فقط (خصوصية)" : real.modelConnected ? `${a.runsToday} مرة اليوم${a.failedToday ? ` · ${a.failedToday} فشل` : ""}` : "ما في موديل موصول — الكود بيكمّل لحاله"}</span>
                  <span dir="ltr" className="w-24 text-end text-xs tabular-nums text-fg-muted">{a.capUsd ? `${fmt(a.todayUsd, "$")} / ${fmt(a.capUsd, "$")}` : "—"}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 text-xs text-fg-muted">
                <span>الشهر لكل الوكلاء (الخارجيين بيوقفوا عند السقف)</span>
                <span dir="ltr" className="tabular-nums">{fmt(real.monthUsd, "$")} / {fmt(real.monthCap, "$", 0)}</span>
              </div>
            </>
          ) : (
            AGENTS.map((a) => (
              <div key={a.code} className="flex items-center gap-3 px-4 py-3 text-sm">
                <span dir="ltr" className="w-10 font-mono text-xs text-fg-muted">{a.code}</span>
                <span className="flex-1 text-fg">{a.name}</span>
                <span className="text-xs text-fg-muted">{a.model}</span>
                <span dir="ltr" className="w-16 text-end text-xs tabular-nums text-fg-muted">{a.cap ? `${fmt(a.cap, "$")}/d` : "—"}</span>
              </div>
            ))
          )}
        </Panel>
      </Section>

      <Section title="الاستيراد والتصدير" hint="رفع ← ربط الأعمدة ← معاينة ← استيراد · نفس الملف مرتين = مرة">
        <div id="import" className="scroll-mt-24">
          <ImportPanel />
        </div>
      </Section>

      <Section title="الفريق والتدقيق" hint="مين عمل شو ومتى: إنسان · قاعدة · وكيل">
        {edit && audit ? (
          <div id="team" className="scroll-mt-24 space-y-4">
            <TeamPanel team={edit.team} me={me && !me.demo ? me.id : null} />
            <div className="flex flex-wrap gap-2 text-xs">
              {[{ k: "", l: "الكل" }, { k: "user", l: "ناس" }, { k: "rule", l: "قواعد" }, { k: "agent", l: "وكلاء" }, { k: "system", l: "النظام" }].map((f) => (
                <a key={f.k} href={`/settings${f.k ? `?audit=${f.k}` : ""}#team`} className={cn("min-h-8 rounded-full border px-3 py-1.5", (actor ?? "") === f.k ? "border-accent bg-accent/10 text-accent" : "border-border text-fg-muted")}>{f.l}</a>
              ))}
            </div>
            <Panel className="divide-y divide-border p-0">
              {audit.length ? audit.map((a) => (
                <div key={a.id} className="space-y-0.5 px-4 py-2 text-sm">
                  <p className="text-fg"><span className="font-medium">{a.who}</span> · {a.action} <span dir="ltr" className="font-mono text-xs text-fg-muted">{a.target}</span> <span className="text-xs text-fg-muted">· {a.at}</span></p>
                  {a.change ? <p dir="ltr" className="truncate text-start font-mono text-[11px] text-fg-muted">{a.change}</p> : null}
                </div>
              )) : <p className="px-4 py-3 text-sm text-fg-muted">ما في شي بالسجل لهالفلتر</p>}
            </Panel>
          </div>
        ) : (
          <Panel id="team" className="scroll-mt-24 text-sm text-fg-muted">
            الفريق والسجل بيبيّنوا لما يشتغل الموقع على البيانات الحقيقية (مش التجريبية).
          </Panel>
        )}
      </Section>

      <Section title="المظهر" hint="أربع ثيمات للميديا باير — بتتبدّل فوراً">
        <Panel id="look" className="scroll-mt-24">
          <ThemePicker />
        </Panel>
      </Section>
    </div>
  );
}
