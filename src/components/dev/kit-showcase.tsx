"use client";

import { useState } from "react";
import { Bell, Plus, Power, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Card, CardBody, CardHeader, EmptyState } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Chip } from "@/components/ui/chip";
import { DataTable, type Column } from "@/components/ui/data-table";
import { ErrorState } from "@/components/ui/error-state";
import { FactsTable } from "@/components/ui/facts-table";
import { Field } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select, Textarea } from "@/components/ui/input";
import { PageShell } from "@/components/ui/page-shell";
import { PILL_TONES, Pill } from "@/components/ui/pill";
import { SectionTitle } from "@/components/ui/section-title";
import { Segmented } from "@/components/ui/segmented";
import { Skeleton } from "@/components/ui/skeleton";
import { Stat } from "@/components/ui/stat";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { ThemePicker } from "@/components/theme/theme-picker";

interface Row {
  id: string;
  name: string;
  spend: number;
  state: "ok" | "warn" | "danger";
}
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

/** Every kit component in every state — the reference the screens are built from (for the owner, at /dev/kit). */
export function KitShowcase() {
  const { toast } = useToast();
  const [view, setView] = useState<"list" | "board">("list");
  const [on, setOn] = useState(true);
  const [checked, setChecked] = useState(true);

  return (
    <PageShell
      title="عدّة الشكل"
      lead="كل مكوّن بكل حالاته. الشاشات بتنبني من هون بس."
      actions={
        <Button size="sm" onClick={() => toast("هيك بيبيّن الإشعار", "success")}>
          جرّب إشعار
        </Button>
      }
    >
      <section className="space-y-3">
        <SectionTitle>الأزرار</SectionTitle>
        <Card>
          <CardBody className="space-y-4">
            {(["primary", "secondary", "ghost", "danger"] as const).map((v) => (
              <div key={v} className="flex flex-wrap items-center gap-2">
                <span className="w-20 text-xs text-fg-muted">{v}</span>
                <Button variant={v} size="lg">كبير 48</Button>
                <Button variant={v}>عادي 40</Button>
                <Button variant={v} size="sm">صغير 32</Button>
                <Button variant={v} disabled>مقفول</Button>
                <Button variant={v} loading>عم يشتغل</Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <span className="w-20 text-xs text-fg-muted">أخرى</span>
              <Button confirm="متأكد؟" variant="danger" onClick={() => toast("انعمل", "success")}>
                احذف
              </Button>
              <Button variant="secondary">
                <Plus className="size-4" aria-hidden /> مع أيقونة
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
            </div>
            <Button block>زر بعرض كامل</Button>
          </CardBody>
        </Card>
      </section>

      <section className="space-y-3">
        <SectionTitle>الشارات</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          {PILL_TONES.map((t) => (
            <Pill key={t} tone={t}>
              {t}
            </Pill>
          ))}
          <Chip>فرع 1.1</Chip>
          <Chip off>فرع 1.2 مطفي</Chip>
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
            <span className="text-base font-extrabold text-fg">عنوان بطاقة</span>
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
            <Skeleton className="h-10 max-md:h-[44px] w-full" />
            <Skeleton className="h-10 max-md:h-[44px] w-3/4" />
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
