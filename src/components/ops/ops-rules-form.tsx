"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { OpsRules } from "@/core/ops";
import { safeFetch } from "@/lib/call";

const show = (n: number | null) => (n === null ? "" : String(n));
const read = (s: string): number | null => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

/** The owner's three limits for the flags beside the team («عالق كتير» · «ما ردّ عالي» · «جديد»). Empty = no flag from that limit. They are his, not ours. */
export function OpsRulesForm({ initial }: { initial: OpsRules }) {
  const router = useRouter();
  const { toast } = useToast();
  const [stuck, setStuck] = useState(show(initial.stuckMax));
  const [margin, setMargin] = useState(show(initial.noAnswerMargin === null ? null : Math.round(initial.noAnswerMargin * 100)));
  const [days, setDays] = useState(show(initial.newDays));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      const m = read(margin);
      const r = await safeFetch("/api/settings/ops.rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: { stuckMax: read(stuck), noAnswerMargin: m === null ? null : m / 100, newDays: read(days) } }) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      toast(d.demo ? "بالوضع التجريبي ما تغيّر شي" : "انحفظت حدودك ✓", d.demo ? "info" : "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-card border border-border bg-surface-1 p-4">
      <p className="text-sm text-fg-muted">حدودك لشارات الفريق. اللي بتتركه فاضي ما بيطلّع شارة. ولا رقم من عندنا.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="عالق فوق 48 ساعة أكتر من" hint="عدد الطلبات">
          <Input inputMode="numeric" dir="ltr" value={stuck} onChange={(e) => setStuck(e.target.value)} />
        </Field>
        <Field label="«ما ردّ» أعلى من وسيط الفريق بـ" hint="نقطة مئوية (مثلاً 10)">
          <Input inputMode="numeric" dir="ltr" value={margin} onChange={(e) => setMargin(e.target.value)} />
        </Field>
        <Field label="«جديد» لو أقل من" hint="عدد الأيام">
          <Input inputMode="numeric" dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} />
        </Field>
      </div>
      <Button loading={busy} onClick={() => void save()}>
        احفظ الحدود
      </Button>
    </div>
  );
}
