import Link from "next/link";
import { ArrowLeft, CircleDot } from "lucide-react";
import { ThemePicker } from "@/components/theme/theme-picker";
import { LevelStars } from "@/components/mb/level-stars";
import { Num } from "@/components/mb/num";
import { Panel, Section } from "@/components/mb/section";
import { StudioLink } from "@/components/settings/studio-link";
import { fmt } from "@/lib/format";
import { ACCOUNTS, LEVEL_AR, LEVEL_HINT, PACE, PRODUCTS, SOURCES, targetsOf, type SourceHealth } from "@/lib/mock/data";
import { omsLinkStatus } from "@/server/oms-link";
import { cn } from "@/lib/utils";

export const metadata = { title: "الإعدادات" };
// The OMS row reads the link from the server's environment on every request, so it can never show a stale «مربوط».
export const dynamic = "force-dynamic";

/** The OMS row is the real link state (host and whether the key is sealed — never the key); the rest is demo for now. */
function sources(): SourceHealth[] {
  const oms = omsLinkStatus();
  return SOURCES.map((s) =>
    s.key !== "oms"
      ? s
      : {
          ...s,
          state: oms.live ? "ok" : "off",
          detail: oms.live ? `مربوط بـ ${oms.host} · ${oms.encrypted ? "المفتاح مشفّر" : "المفتاح مش مشفّر (جهاز تطوير)"}` : (oms.why ?? "مش مربوط"),
        },
  );
}

const GROUPS = [
  { id: "connections", label: "الربط" },
  { id: "money", label: "المال والسقوف" },
  { id: "products", label: "المنتجات" },
  { id: "rules", label: "القواعد والمستويات" },
  { id: "agents", label: "الوكلاء" },
  { id: "team", label: "الفريق والتدقيق" },
  { id: "look", label: "المظهر" },
];

const AGENTS = [
  { code: "M11", name: "كاتب التقارير", model: "داخلي · qwen3:4b", cap: 0.5 },
  { code: "M02", name: "المحلل اليومي", model: "داخلي · qwen2.5:7b", cap: 3 },
  { code: "H01", name: "محلل الأسماء", model: "داخلي فقط (خصوصية)", cap: 0 },
];

/** Everything set once and forgotten (S02 S12 S09 S13 S16 S17 S18), grouped, one anchor per group. */
export default function SettingsPage() {
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
          {sources().map((s) => (
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
          <StudioLink />
        </div>
      </Section>

      <Section title="المال والسقوف" hint="ولا دولار فوق السقف، ولا حملة جديدة بلا سقف معروف">
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
      </Section>

      <Section title="المنتجات" hint="أرقام الحاسبة — بتنسحب من الـ OMS لما ينربط">
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
      </Section>

      <Section title="القواعد والمستويات" hint="البداية ★ لكل الحسابات · ★★ بعد أسبوعين مراجعة · ★★★ مطفي">
        <div id="rules" className="grid scroll-mt-24 gap-3 md:grid-cols-2">
          {ACCOUNTS.map((a) => (
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
          {AGENTS.map((a) => (
            <div key={a.code} className="flex items-center gap-3 px-4 py-3 text-sm">
              <span dir="ltr" className="w-10 font-mono text-xs text-fg-muted">{a.code}</span>
              <span className="flex-1 text-fg">{a.name}</span>
              <span className="text-xs text-fg-muted">{a.model}</span>
              <span dir="ltr" className="w-16 text-end text-xs tabular-nums text-fg-muted">{a.cap ? `${fmt(a.cap, "$")}/d` : "—"}</span>
            </div>
          ))}
        </Panel>
      </Section>

      <Section title="الفريق والتدقيق" hint="مين عمل شو ومتى: إنسان · قاعدة · وكيل">
        <Panel id="team" className="scroll-mt-24 text-sm text-fg-muted">
          الحسابات والأدوار (مالك · مدير إعلانات · محلل · مشاهد) والتدقيق بيجهزوا بالمرحلة 1 (T1.2).
        </Panel>
      </Section>

      <Section title="المظهر" hint="أربع ثيمات للميديا باير — بتتبدّل فوراً">
        <Panel id="look" className="scroll-mt-24">
          <ThemePicker />
        </Panel>
      </Section>
    </div>
  );
}
