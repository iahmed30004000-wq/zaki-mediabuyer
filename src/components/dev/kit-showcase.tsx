"use client";

import { useState } from "react";
import { Bell, Plus, Power, Settings } from "lucide-react";
import { RopePlayground } from "@/components/dev/rope-playground";
import { ThemePicker } from "@/components/theme/theme-picker";
import { AgentChip } from "@/components/ui/agent-chip";
import { BackLink } from "@/components/ui/back-link";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ChoiceTile } from "@/components/ui/choice-tile";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { DayBoard, type DayBoardRow } from "@/components/ui/day-board";
import { Delta } from "@/components/ui/delta";
import { ErrorState } from "@/components/ui/error-state";
import { FactsTable } from "@/components/ui/facts-table";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { JobNumber } from "@/components/ui/job-number";
import { Lamp } from "@/components/ui/lamp";
import { LightStrip } from "@/components/ui/light-strip";
import { PageShell } from "@/components/ui/page-shell";
import { PILL_TONES, Pill } from "@/components/ui/pill";
import { PushPreview } from "@/components/ui/push-preview";
import { ReadinessCard } from "@/components/ui/readiness-card";
import { ReportBody } from "@/components/ui/report-body";
import { RunSteps } from "@/components/ui/run-steps";
import { SectionTitle } from "@/components/ui/section-title";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Sparkline } from "@/components/ui/sparkline";
import { Stat } from "@/components/ui/stat";
import { StateWord } from "@/components/ui/state-word";
import { StepBlock, StepBlocks, StepJoint } from "@/components/ui/step-block";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { TrendChart } from "@/components/ui/trend-chart";
import { WasNow } from "@/components/ui/was-now";
import { WORD_STATES } from "@/core/state-word";
import type { StripStep } from "@/core/light-strip";
import type { Lamp as LampState } from "@/core/run-state";
import type { WordState } from "@/core/state-word";

interface Row {
  id: string;
  name: string;
  spend: number;
  state: "ok" | "warn" | "danger";
}
// EXAMPLES for looking at the shapes — none of these is a real number, name or job.
const ROWS: Row[] = [
  { id: "a", name: "منتج تجريبي أ", spend: 120.5, state: "ok" },
  { id: "b", name: "منتج تجريبي ب", spend: 48, state: "warn" },
  { id: "c", name: "منتج تجريبي ج", spend: 9.75, state: "danger" },
];
const COLUMNS: Column<Row>[] = [
  { key: "name", header: "المنتج", cell: (r) => r.name },
  { key: "spend", header: "الصرف", numeric: true, cell: (r) => `${r.spend}$` },
  { key: "state", header: "الحالة", cell: (r) => <Pill tone={r.state}>{r.state === "ok" ? "رابح" : r.state === "warn" ? "انتباه" : "خسران"}</Pill> },
];

const strip = (...lamps: LampState[]): StripStep[] => lamps.map((lamp, i) => ({ id: `k${i}`, lamp }));
const LONG = strip(...Array.from({ length: 16 }, (_, i): LampState => (i < 11 ? "done" : i === 11 ? "run" : "off")));

const SERIES = [8.4, 8.1, 7.9, 8.6, 9.2, 9.0, 8.7, 8.2, 7.8, 7.5, 7.7, 7.2, 6.9, 7.1, 6.8, 6.6, 6.9, 6.5, 6.2, 6.4, 6.1, 5.9, null, 5.8, 5.6, 5.9, 5.5, 5.3, 5.4, 5.2];

const BOARD: DayBoardRow[] = [
  { id: "r1", time: "06:00", title: "جولة الليل", who: "Claude الرئيسي", state: "done", past: true },
  { id: "r2", time: "09:00", title: "تقرير الصبح", who: "Claude الرئيسي", state: "missed", past: true },
  { id: "r3", time: "12:30", title: "تنبيهات المخزون", who: "Claude الرئيسي", state: "run" },
  { id: "r4", time: "15:00", title: "فحص الفيديوهات", who: "Claude الرئيسي", state: "queued" },
  { id: "r5", time: "21:00", title: "ملخص اليوم", who: "Claude الرئيسي", state: "next" },
];

const TOKENS = ["surface", "surface-1", "surface-2", "border", "muted", "fg", "fg-muted", "accent", "accent-fg", "accent-2", "ok", "info", "warn", "danger", "tape", "key-edge"] as const;
const TOKEN_BG: Record<(typeof TOKENS)[number], string> = {
  surface: "bg-surface",
  "surface-1": "bg-surface-1",
  "surface-2": "bg-surface-2",
  border: "bg-border",
  muted: "bg-muted",
  fg: "bg-fg",
  "fg-muted": "bg-fg-muted",
  accent: "bg-accent",
  "accent-fg": "bg-accent-fg",
  "accent-2": "bg-accent-2",
  ok: "bg-ok",
  info: "bg-info",
  warn: "bg-warn",
  danger: "bg-danger",
  tape: "bg-tape",
  "key-edge": "bg-key-edge",
};

/** Every kit component in every state — the reference the screens are built from (for the owner, at /dev/kit). Compare it with `mockups.html` on the phone. */
export function KitShowcase() {
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "board">("list");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);
  const [every, setEvery] = useState<"day" | "week" | "month">("day");

  return (
    <PageShell
      title="عدّة الشكل"
      lead="كل مكوّن بكل حالاته. الأرقام والأسماء هون أمثلة للشكل بس، مش حقيقية."
      actions={
        <Button size="sm" onClick={() => toast("هيك بيبيّن الإشعار", "success")}>
          جرّب إشعار
        </Button>
      }
    >
      <section className="space-y-3">
        <SectionTitle hint="اللون بيحكي حالة بس. الأزرار مفاتيح حبر.">الألوان</SectionTitle>
        <Card>
          <CardBody>
            <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 sm:grid-cols-4">
              {TOKENS.map((t) => (
                <li key={t} className="flex items-center gap-2.5">
                  <span aria-hidden className={`size-9 shrink-0 rounded-lg border border-border ${TOKEN_BG[t]}`} />
                  <span dir="ltr" className="text-sm text-fg-muted">
                    {t}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <BrandMark className="size-9" />
              <JobNumber n={7} />
              <span className="text-sm text-fg-muted">الذهبي: الشعار ورقم المهمة بس</span>
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="الأساسي واحد بكل شاشة: 52 · 48 · 40. ولا زر تحت 40.">الأزرار</SectionTitle>
        <Card>
          <CardBody className="space-y-4">
            {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-2">
                <span className="w-20 text-sm text-fg-muted">{v}</span>
                <Button variant={v} size="lg">
                  كبير 52
                </Button>
                <Button variant={v}>عادي 48</Button>
                <Button variant={v} size="sm">
                  صغير 40
                </Button>
                <Button variant={v} disabled>
                  مقفول
                </Button>
                <Button variant={v} loading>
                  عم يشتغل
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-sm text-fg-muted">أخرى</span>
              <Button confirm="متأكد؟" variant="danger" onClick={() => toast("انعمل", "success")}>
                اوقف الكل
              </Button>
              <Button variant="secondary">
                <Plus className="size-5" aria-hidden /> مع أيقونة
              </Button>
              <ButtonLink href="/dev/kit" variant="secondary">
                رابط بشكل زر
              </ButtonLink>
              <IconButton aria-label="الإعدادات">
                <Settings className="size-5" aria-hidden />
              </IconButton>
              <IconButton aria-label="الإشعارات">
                <Bell className="size-5" aria-hidden />
              </IconButton>
              <IconButton aria-label="الإيقاف الكامل" tone="danger">
                <Power className="size-5" aria-hidden />
              </IconButton>
              <BackLink href="/dev/kit" />
            </div>
            <Button block>زر بعرض كامل</Button>
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="اللمبة ما بتنعرض لحالها بلا كلمة، إلا جوّا الحبل.">اللمبات والكلمات</SectionTitle>
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center gap-5">
              {(["off", "run", "done", "wait", "fail", "missed"] as const).map((l) => (
                <span key={l} className="inline-flex items-center gap-2 text-sm text-fg-muted">
                  <Lamp state={l} size={20} label={l} />
                  {l}
                </span>
              ))}
            </div>
            <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-2 md:grid-cols-3">
              {WORD_STATES.map((s: WordState) => (
                <li key={s}>
                  <StateWord state={s} who="Claude الرئيسي" />
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="خطوة خلصت = مقطع أخضر · الشغّالة = ديودات بتجري · فوق 12 خطوة على الجوال بتنضغط.">حبل الضو</SectionTitle>
        <Card>
          <CardBody className="space-y-4">
            <LightStrip steps={strip("done", "done", "run", "off", "off")} label="هلق عند الخطوة 3 من 5" />
            <LightStrip steps={strip("done", "done", "done", "wait", "off")} label="واقفة عند 4: بانتظار موافقتك" big />
            <LightStrip steps={strip("done", "done", "fail", "off")} label="وقفت عند 3" />
            <LightStrip steps={[{ id: "a", lamp: "done", inferred: true }, { id: "b", lamp: "done", inferred: true }, { id: "c", lamp: "done", inferred: true }]} label="خلصت — Claude سجّل النهاية بس، بلا تفاصيل الخطوات" />
            <LightStrip steps={LONG} label="هلق عند الخطوة 12 من 16" />
            <RunSteps
              label="خطوات مثال"
              steps={[
                { id: "a", n: 1, lamp: "done", title: "اقرا المخزون", note: "12 منتج", time: "09:00" },
                { id: "b", n: 2, lamp: "run", title: "اقرا الأرقام", note: "عم نسحب من نظام الطلبات" },
                { id: "c", n: 3, lamp: "off", title: "قرّر مين يكبر" },
                { id: "d", n: 4, lamp: "off", title: "ابعت التقرير" },
              ]}
            />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="أزرار بتمشّي تشغيل تجريبي خطوة خطوة.">ملعب الحبل</SectionTitle>
        <RopePlayground />
      </section>

      <section className="space-y-3">
        <SectionTitle hint="الرقم من الكود، والفرق بكلام. الناقص «—» مع سبب.">كنا ← صرنا</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
          <WasNow label="تكلفة الطلب الحقيقية" now={5.2} was={6.0} unit="$" source="truth" delta={{ words: "أرخص 13%", tone: "good" }} series={SERIES} />
          <WasNow label="الطلبات المؤكدة" now={38} was={32} source="truth" delta={{ words: "أكتر 19%", tone: "good" }} series={[3, 4, 3, 5, 4, 6, 5, 4, 6, 7, 5, 6, 7, 8]} />
          <WasNow label="الصرف" now={412.6} was={380} unit="$" source="meta" delta={{ words: "زاد 9%", tone: "flat" }} series={[28, 30, 29, 31, 30, 33, 32, 31, 35, 34, 36, 33, 37, 35]} />
          <WasNow label="تكلفة الطلب" now={null} was={null} unit="$" missing="ميتا مش مربوطة" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Delta words="أرخص 13%" tone="good" />
          <Delta words="أغلى 8%" tone="bad" />
          <Delta words="متل ما هو" tone="flat" />
          <span className="w-32">
            <Sparkline values={SERIES} label="مثال على الخط الصغير" />
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="خط التعادل أحمر متقطّع، الهدف أخضر منقّط، والدواير المرقّمة شو عملنا.">الرسم الكبير</SectionTitle>
        <Card>
          <CardBody>
            <TrendChart
              values={SERIES}
              unit="$"
              breakEven={7.5}
              target={5}
              label="مثال: تكلفة الطلب الحقيقية آخر 30 يوم"
              xLabels={{ oldest: "قبل 30 يوم", newest: "اليوم" }}
              events={[
                { index: 6, text: "جولة الليل: كبّرت 2 ووقّفت 3" },
                { index: 14, text: "نزل 12 فيديو جديد" },
                { index: 24, text: "كبّرنا منتج 20%" },
              ]}
            />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>جدول اليوم</SectionTitle>
        <Card>
          <CardBody>
            <DayBoard label="جدول اليوم (مثال)" rows={BOARD} />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="بلوكات فوق بعض. السهمين بيحرّكوا، والإكس بيحذف.">بناء مهمة</SectionTitle>
        <Card>
          <CardBody className="space-y-4">
            <div role="group" aria-label="كل قديش" className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <ChoiceTile title="كل يوم" hint="الساعة 6 الصبح" pressed={every === "day"} onClick={() => setEvery("day")} />
              <ChoiceTile title="كل أسبوع" hint="يوم الأحد" pressed={every === "week"} onClick={() => setEvery("week")} />
              <ChoiceTile title="كل شهر" hint="أول يوم" pressed={every === "month"} onClick={() => setEvery("month")} />
            </div>
            <StepBlocks label="خطوات مثال">
              <StepBlock n={1} kind="اقرا المخزون" onDown={() => toast("تحرّكت", "info")} onRemove={() => toast("انحذفت", "info")}>
                كل المنتجات الشغّالة
              </StepBlock>
              <StepJoint />
              <StepBlock n={2} kind="قرّر مين يكبر" onUp={() => toast("تحرّكت", "info")} onDown={() => toast("تحرّكت", "info")} onRemove={() => toast("انحذفت", "info")}>
                حسب القواعد
              </StepBlock>
              <StepJoint />
              <StepBlock n={3} kind="ابعت التقرير" onUp={() => toast("تحرّكت", "info")} onRemove={() => toast("انحذفت", "info")} />
            </StepBlocks>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              <AgentChip name="Claude الرئيسي" doing="عم يقرا المخزون" state="run" />
              <AgentChip name="وكيل الفيديو" doing="بانتظار موافقتك" state="wait" />
              <AgentChip name="وكيل الأرقام" state="off" />
            </div>
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>شو ناقص، تقرير، إشعار</SectionTitle>
        <div className="grid gap-4 md:grid-cols-2">
          <ReadinessCard
            rows={[
              { key: "spend", ok: false, text: "الصرف ناقص: ميتا مش مربوطة", action: { label: "اربط ميتا", href: "/dev/kit" } },
              { key: "orders", ok: true, text: "آخر سحب من نظام الطلبات: قبل ساعة" },
              { key: "be", ok: false, text: "5 منتجات بلا نقطة تعادل", action: { label: "اكتبهم", href: "/dev/kit" } },
            ]}
          />
          <Card>
            <CardBody>
              <ReportBody
                report={{ scaled: 2, paused: 3, products: [{ name: "منتج أ", orders: 12 }, { name: "منتج ب", orders: 7 }] }}
                labels={{ scaled: "كبّرنا", paused: "وقّفنا", products: "المنتجات", name: "المنتج", orders: "الطلبات" }}
              />
            </CardBody>
          </Card>
        </div>
        <PushPreview title="بدها موافقتك" body="كبّر «منتج أ» 20%؟ الصرف هيصير أكتر بـ 15$ باليوم." time="09:12" />
      </section>

      <section className="space-y-3">
        <SectionTitle>الشارات</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          {PILL_TONES.map((t) => (
            <Pill key={t} tone={t}>
              {t}
            </Pill>
          ))}
          <Chip>خطوة 1</Chip>
          <Chip off>خطوة 2 مطفية</Chip>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle hint="الرقم من الكود، والناقص «—» مش صفر." href="/dev/kit" linkLabel="عرض الكل">
          البلاطات
        </SectionTitle>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="الصرف" value={412.6} unit="$" source="meta" note="أمس: 380$" bar={62} />
          <Stat label="الطلبات" value={38} source="truth" tone="ok" note="مؤكدة" />
          <Stat label="التكلفة للطلب" value={null} unit="$" />
          <Stat label="نسبة الرجوع" value={31.5} unit="%" tone="warn" />
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>بطاقة، جدول، حقايق</SectionTitle>
        <Card>
          <CardHeader>
            <span className="font-display text-lg font-extrabold text-fg">عنوان بطاقة</span>
          </CardHeader>
          <CardBody className="space-y-3">
            <Segmented
              label="العرض"
              value={view}
              onChange={setView}
              options={[
                { value: "list", label: "قائمة" },
                { value: "board", label: "كانبان" },
              ]}
            />
            <DataTable columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} label="جدول تجريبي" />
            <FactsTable facts={[{ label: "الموعد", value: "كل يوم 06:00" }, { label: "بيجي من", value: "Claude" }, { label: "حقل فاضي", value: null }]} />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>الحقول</SectionTitle>
        <Card>
          <CardBody className="grid gap-4 md:grid-cols-2">
            <Field label="اسم" hint="سطر مساعد" required>
              <Input placeholder="اكتب هون" />
            </Field>
            <Field label="فيها خطأ" error="هالقيمة مش صحيحة">
              <Input defaultValue="٣٢" />
            </Field>
            <Field label="اختيار">
              <Select defaultValue="a">
                <option value="a">خيار أ</option>
                <option value="b">خيار ب</option>
              </Select>
            </Field>
            <Field label="نص طويل">
              <Textarea rows={2} />
            </Field>
            <Switch checked={on} onCheckedChange={setOn} label="مفتاح تشغيل" />
            <Checkbox label="خانة اختيار" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>الحالات</SectionTitle>
        <div className="grid gap-3 md:grid-cols-3">
          <EmptyState title="ما في شي هون" hint="ابدأ بإضافة واحد." action={{ label: "ضيف", href: "/dev/kit" }} />
          <ErrorState hint="الاتصال ضعيف" onRetry={() => toast("عم نعيد المحاولة")} />
          <div className="space-y-2 rounded-card border border-border p-4">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <SectionTitle>المظهر</SectionTitle>
        <Card>
          <CardBody>
            <ThemePicker />
          </CardBody>
        </Card>
      </section>
    </PageShell>
  );
}
