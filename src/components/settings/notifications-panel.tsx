"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Smartphone } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { PushPreview } from "@/components/ui/push-preview";
import { Segmented } from "@/components/ui/segmented";
import { useToast } from "@/components/ui/toast";
import { KIND_TABLE, defaultPref, type NotifyPref } from "@/core/notify-plan";
import { IOS_STEPS, type PushState } from "@/core/push-env";
import { callJson } from "@/lib/call";
import { currentPushState, disablePush, enablePush, preloadPushConfig, thisDeviceId } from "@/lib/push-client";

export interface DeviceRow {
  id: string;
  label: string;
  platform: string | null;
  /** «قبل 5 دقايق» */
  seen: string;
}

export interface NotificationsPanelProps {
  prefs: Record<string, NotifyPref>;
  devices: DeviceRow[];
  /** the names of the Firebase values still missing (empty = set up) */
  missing: string[];
  /** he may open «الربط» */
  canLink: boolean;
  /** notices saved in the bell that never left it */
  waiting: number;
  held: number;
  gaveUp: number;
  demo: boolean;
}

const PREF_OPTIONS = [
  { value: "ring", label: "بيرنّ" },
  { value: "silent", label: "صامت" },
  { value: "site", label: "بالموقع بس" },
] as const;

/**
 * «الإشعارات» (docs/rebuild-v6/05-notify.md §4): what he chooses to ring, silent, or only in the bell — per kind; this phone's switch; his phones with «شيله»; and a test.
 * With Firebase not set up the page says so in plain words (what is missing, where to paste it) and what still works: the bell, and Telegram when it is linked.
 */
export function NotificationsPanel({ prefs: initial, devices, missing, canLink, waiting, held, gaveUp, demo }: NotificationsPanelProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [prefs, setPrefs] = useState(initial);
  const [state, setState] = useState<PushState | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setState(currentPushState());
    setMine(thisDeviceId());
    // fetched now, so the press of «فعّل» can ask for the permission before any network call (Safari/iOS need that)
    void preloadPushConfig().catch(() => undefined);
  }, []);

  const setup = missing.length === 0;
  const registeredHere = !!mine && devices.some((d) => d.id === mine);

  async function choose(kind: string, value: NotifyPref) {
    const before = prefs;
    setPrefs({ ...prefs, [kind]: value });
    const r = await callJson("/api/push/prefs", { method: "PUT", body: { [kind]: value } });
    if (!r.ok) {
      setPrefs(before);
      toast(r.error ?? "ما انحفظ", "error");
    } else if ((r.data as { demo?: boolean } | null)?.demo) toast("بالوضع التجريبي ما تغيّر شي", "info");
  }

  async function turnOn() {
    setBusy("on");
    try {
      const r = await enablePush();
      if (!r.ok) return toast(r.sentence, "error");
      setMine(r.deviceId);
      setState(currentPushState());
      toast("اشتغلت الإشعارات على هالجهاز ✓", "success");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function test(ring: boolean) {
    setBusy(ring ? "ring" : "test");
    try {
      const r = await callJson<{ ok: boolean; sent: number; failed: number; reason: string | null }>("/api/push/test", { method: "POST", body: { ring } });
      if (!r.ok || !r.data) return toast(r.error ?? "ما اشتغل", "error");
      if (r.data.ok) return toast(`انبعت لـ ${r.data.sent} جهاز — لازم يوصلك هلق`, "success");
      toast(r.data.reason === "setup_needed" ? "لازم تربط Firebase أول" : r.data.reason === "no_device" ? "ما في جهاز مسجّل — فعّل الإشعارات على جوالك أول" : "Firebase ما قبل الإشعار — جرّب كمان مرة", "error");
    } finally {
      setBusy(null);
    }
  }

  async function remove(d: DeviceRow) {
    setBusy(d.id);
    try {
      if (d.id === mine) await disablePush();
      else {
        const r = await callJson(`/api/push/devices/${encodeURIComponent(d.id)}`, { method: "DELETE" });
        if (!r.ok) return toast(r.error ?? "ما انشال", "error");
      }
      if (d.id === mine) setMine(null);
      toast("انشال الجهاز ✓", "success");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      {!setup ? (
        <Panel className="space-y-2 border-warn/40" id="setup-needed">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone="warn">لازم تجهّز Firebase</Pill>
            <p className="text-base font-extrabold text-fg">إشعارات الجوال مش شغّالة لسا</p>
          </div>
          <p className="text-base text-fg">لحد ما تربط Firebase، كل إشعار بيضل بالجرس بالموقع (وبتيليجرام لو مربوط). ولا شي ضايع.</p>
          <p className="text-sm text-fg-muted">
            ناقص: <span dir="ltr">{missing.join(" · ")}</span>
          </p>
          {canLink ? (
            <Link href="/settings/connections#row-firebase" className="inline-flex min-h-11 items-center font-semibold text-info hover:underline">
              الصقهم من «الإعدادات ← الربط» ←
            </Link>
          ) : (
            <p className="text-sm text-fg-muted">المالك بيلصقهم من «الإعدادات ← الربط».</p>
          )}
        </Panel>
      ) : null}

      {waiting || gaveUp ? (
        <Panel className="space-y-1">
          {waiting ? (
            <p className="text-base text-fg">
              {waiting} {waiting === 1 ? "إشعار انحفظ" : "إشعارات انحفظت"} بالجرس وما طلعت لبرّا{held ? ` (${held} بينتظروا تصحى)` : ""}.
            </p>
          ) : null}
          {gaveUp ? <p className="text-base text-danger">{gaveUp} {gaveUp === 1 ? "إشعار" : "إشعارات"} ما قدرنا نبعتهم بعد كم محاولة — بتلاقيهم بالجرس.</p> : null}
        </Panel>
      ) : null}

      <Panel className="space-y-3" id="this-device">
        <div className="flex items-center gap-2">
          <Smartphone className="size-5 text-fg-muted" aria-hidden />
          <h2 className="text-base font-extrabold text-fg">هالجهاز</h2>
          {registeredHere ? <Pill tone="ok">شغّالة</Pill> : null}
        </div>
        {state === null ? (
          <p className="text-sm text-fg-muted">عم نفحص المتصفح…</p>
        ) : state === "ios_install" ? (
          <div className="space-y-2">
            <p className="text-base text-fg">على الآيفون الإشعار بيشتغل بس لما الموقع «مضاف للشاشة الرئيسية» (iOS 16.4 وفوق). ثلاث خطوات:</p>
            <ol className="list-decimal space-y-1 ps-6 text-base text-fg">
              {IOS_STEPS.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        ) : state === "unsupported" ? (
          <p className="text-base text-fg">هالمتصفح ما بيدعم إشعارات الجوال. جرّب كروم على أندرويد أو الكمبيوتر.</p>
        ) : state === "denied" ? (
          <p className="text-base text-fg">انرفض الإذن لهالموقع. بتقدر ترجّعه من إعدادات المتصفح (الأيقونة جنب عنوان الموقع ← الإشعارات ← اسمح)، وبعدين ارجع.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {!registeredHere ? (
              <Button loading={busy === "on"} disabled={demo || !setup} onClick={turnOn}>
                فعّل الإشعارات على هالجهاز
              </Button>
            ) : null}
            <Button variant="secondary" loading={busy === "test"} disabled={demo || !setup} onClick={() => test(false)}>
              جرّب
            </Button>
            <Button variant="secondary" loading={busy === "ring"} disabled={demo || !setup} onClick={() => test(true)}>
              جرّب الرنين
            </Button>
          </div>
        )}
        {!setup && state !== "ios_install" ? <p className="text-sm text-fg-muted">الأزرار بتشتغل بعد ما تجهّز Firebase.</p> : null}
        {demo ? <p className="text-sm text-fg-muted">الموقع على الوضع التجريبي: الإشعارات بدها موقع حقيقي.</p> : null}
        <p className="text-sm text-fg-muted">إشعار المتصفح بيعمل صوت مرة وحدة وبيضل ظاهر. ما بيرنّ دقيقة متل المنبّه.</p>
      </Panel>

      <Panel className="space-y-3" id="kinds">
        <h2 className="text-base font-extrabold text-fg">إنت بتختار شو يرنّ</h2>
        <PushPreview title="بدّها قرارك: تكبير «حرير 3» +20%" body="من 50$ لـ 60$ باليوم. اضغط تفتح القرار." />
        <ul className="m-0 list-none divide-y divide-border p-0">
          {KIND_TABLE.map((k) => {
            const value = prefs[k.kind] ?? defaultPref({ kind: k.kind, urgency: "red" });
            return (
              <li key={k.kind} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-fg">{k.label}</span>
                  <span className="block text-sm text-fg-muted">{k.example}</span>
                </span>
                <Segmented value={value} onChange={(v) => void choose(k.kind, v)} options={PREF_OPTIONS} label={k.label} />
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-fg-muted">وإنت نايم: بيرنّ بس القرار الأحمر من نوع «بيصحّيني». الباقي بيستنى، ولما تصحى بيوصلك إشعار واحد: «وإنت نايم: 2 وقفوا، 1 فاتت». أكتر من 5 إشعارات بعشر دقايق بتصير واحد.</p>
      </Panel>

      <Panel className="space-y-3" id="devices">
        <h2 className="text-base font-extrabold text-fg">أجهزتك</h2>
        {devices.length ? (
          <ul className="m-0 list-none divide-y divide-border p-0">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-bold text-fg">
                    {d.label}
                    {d.id === mine ? <span className="ms-2 text-sm font-semibold text-ok">هالجهاز</span> : null}
                  </span>
                  <span className="block text-sm text-fg-muted">آخر ظهور: {d.seen}</span>
                </span>
                <Button variant="secondary" size="sm" loading={busy === d.id} confirm="تشيله؟" onClick={() => remove(d)}>
                  شيله
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-base text-fg-muted">ما في جهاز مسجّل لسا.</p>
        )}
      </Panel>
    </div>
  );
}
