"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Input, Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import type { NightPermission, OwnerMode } from "@/core/mode";

/**
 * «صاحي ونايم»: the schedule (awake from … asleep from …), the jobs that may run while he sleeps — each with the most it
 * may spend — and the kinds of decision that may still ring him («يصحّيني»). Everything he does not list waits for the morning.
 */
export function ModeSettings({ schedule, night, wakeKinds, workflows, demo }: { schedule: OwnerMode["schedule"]; night: NightPermission[]; wakeKinds: string[]; workflows: { key: string; name: string }[]; demo: boolean }) {
  const { toast } = useToast();
  const router = useRouter();
  const [sch, setSch] = useState(schedule);
  const [perms, setPerms] = useState(night);
  const [kinds, setKinds] = useState(wakeKinds);
  const [pick, setPick] = useState("");
  const [cap, setCap] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch("/api/mode", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(patch) });
      const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      toast(d.demo ? "بالوضع التجريبي ما تغيّر شي" : "انحفظ ✓", d.demo ? "info" : "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const free = workflows.filter((w) => !perms.some((p) => p.key === w.key));
  return (
    <Panel className="space-y-5">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-fg">جدول تلقائي</p>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="inline-flex min-h-9 items-center gap-2 text-fg">
            <input type="checkbox" checked={sch.enabled} onChange={(e) => setSch({ ...sch, enabled: e.target.checked })} className="size-4 accent-[var(--accent,#2563eb)]" />
            شغّله
          </label>
          <label className="inline-flex items-center gap-2 text-fg-muted">
            صاحي من
            <Input type="time" dir="ltr" value={sch.awake} onChange={(e) => setSch({ ...sch, awake: e.target.value })} className="w-28" />
          </label>
          <label className="inline-flex items-center gap-2 text-fg-muted">
            نايم من
            <Input type="time" dir="ltr" value={sch.asleep} onChange={(e) => setSch({ ...sch, asleep: e.target.value })} className="w-28" />
          </label>
          <Button size="sm" disabled={busy || !sch.awake || !sch.asleep} onClick={() => save({ schedule: sch })}>
            احفظ
          </Button>
        </div>
        <p className="text-xs text-fg-muted">مع الجدول شغّال، الساعة بتحكم. وإذا ضغطت زر «صاحي/نايم» باليوم بيوقف الجدول.</p>
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-sm font-semibold text-fg">صلاحيات الليل</p>
        <p className="text-xs text-fg-muted">المهام اللي بتشتغل وإنت نايم، ولكل وحدة أقصى صرف. أي شي مش هون بيستنى للصبح.</p>
        <ul className="space-y-1.5">
          {perms.map((p) => (
            <li key={p.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="flex-1 text-fg">{p.label}</span>
              <span dir="ltr" className="font-mono text-xs text-fg-muted">{p.key}</span>
              <span className="text-xs text-fg-muted">{p.cap ? `حد ${p.cap}$` : "بلا صرف"}</span>
              <IconButton aria-label={`شيل ${p.label}`} disabled={busy} onClick={() => { const next = perms.filter((x) => x.key !== p.key); setPerms(next); void save({ nightPermissions: next }); }}>
                <X className="size-4" />
              </IconButton>
            </li>
          ))}
          {!perms.length ? <li className="text-xs text-fg-muted">ولا مهمة مسموحة بالليل.</li> : null}
        </ul>
        {free.length ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const w = workflows.find((x) => x.key === pick);
              if (!w) return;
              const next = [...perms, { key: w.key, label: w.name, cap: cap ? Number(cap) : null }];
              setPerms(next);
              setPick("");
              setCap("");
              void save({ nightPermissions: next });
            }}
          >
            <Select value={pick} onChange={(e) => setPick(e.target.value)} className="w-56" aria-label="مهمة">
              <option value="">— اختار مهمة —</option>
              {free.map((w) => <option key={w.key} value={w.key}>{w.name}</option>)}
            </Select>
            <Input dir="ltr" inputMode="decimal" placeholder="حد الصرف $" value={cap} onChange={(e) => setCap(e.target.value.replace(/[^\d.]/g, ""))} className="w-32" aria-label="حد الصرف بالدولار" />
            <Button size="sm" variant="secondary" type="submit" disabled={!pick || busy}>
              <Plus className="size-3.5" /> أضف
            </Button>
          </form>
        ) : null}
      </div>

      <div className="space-y-2 border-t border-border pt-4">
        <p className="text-sm font-semibold text-fg">قرارات بتصحّيني</p>
        <p className="text-xs text-fg-muted">أنواع القرارات (الحقل kind اللي بيبعته Claude، مثلاً <span dir="ltr" className="font-mono">cap_raise</span>) اللي بيصير الرنين عليها حتى وإنت نايم.</p>
        <div className="flex flex-wrap gap-2">
          {kinds.map((k) => (
            <span key={k} className="inline-flex items-center gap-1 rounded-full bg-surface-2 py-1 ps-3 pe-1 text-xs text-fg">
              <span dir="ltr" className="font-mono">{k}</span>
              <button type="button" aria-label={`شيل ${k}`} disabled={busy} onClick={() => { const next = kinds.filter((x) => x !== k); setKinds(next); void save({ wakeKinds: next }); }} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-surface-1">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
          {!kinds.length ? <span className="text-xs text-fg-muted">ولا نوع — ما في شي بيصحّيك.</span> : null}
        </div>
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const k = kind.trim().toLowerCase().replace(/\s+/g, "_");
            if (!k || kinds.includes(k)) return;
            const next = [...kinds, k];
            setKinds(next);
            setKind("");
            void save({ wakeKinds: next });
          }}
        >
          <Input dir="ltr" value={kind} onChange={(e) => setKind(e.target.value)} placeholder="cap_raise" className="w-48 font-mono" aria-label="نوع القرار" />
          <Button size="sm" variant="secondary" type="submit" disabled={!kind.trim() || busy}>أضف</Button>
        </form>
      </div>
      {demo ? <p className="text-xs text-fg-muted">(تجريبي: ما بينحفظ شي)</p> : null}
    </Panel>
  );
}
