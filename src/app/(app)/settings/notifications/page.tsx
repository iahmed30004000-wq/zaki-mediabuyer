import { ModeSwitch } from "@/components/home/mode-switch";
import { ModeSettings } from "@/components/settings/mode-settings";
import { NotificationsPanel } from "@/components/settings/notifications-panel";
import { firebaseMissing } from "@/adapters/fcm";
import { agoWords } from "@/core/bell";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { loadWorkflowCards } from "@/lib/workflow-view";
import { currentCaller, requirePage } from "@/server/auth";
import { currentMode } from "@/server/mode";
import { loadNotifyStatus } from "@/server/notifications";
import { audienceOfUser, getPrefs, listDevices } from "@/server/push-devices";

export const metadata = { title: "الإشعارات" };
export const dynamic = "force-dynamic";

/**
 * الإعدادات ← الإشعارات (docs/rebuild-v6/05-notify.md §4): what rings, what is silent and what stays in the bell — per kind of notice; this phone and the other phones with «شيله»; a test;
 * and the awake / asleep switch with its schedule (moved here from «القواعد»). With Firebase not set up it says what is missing and what still works.
 */
export default async function NotificationsPage() {
  await requirePage("settings.view");
  const me = await currentCaller();
  if (!me) return null;
  const demo = isDemo(process.env) || me.demo;
  const now = new Date();
  // the demo has no database: its switch and night list are not shown (nothing real to set)
  const [mode, wf, prefs, devices, status] = await Promise.all([
    demo ? Promise.resolve(null) : currentMode(),
    demo ? Promise.resolve(null) : loadWorkflowCards(),
    demo ? Promise.resolve({}) : getPrefs(me.id),
    demo ? Promise.resolve([]) : listDevices(me.id),
    demo ? Promise.resolve({ waiting: 0, held: 0, gaveUp: 0 }) : audienceOfUser(me).then((a) => (a ? loadNotifyStatus(a, now) : { waiting: 0, held: 0, gaveUp: 0 })),
  ]);
  return (
    <div className="space-y-4">
      <NotificationsPanel
        prefs={prefs}
        devices={devices.map((d) => ({ id: d.id, label: d.label, platform: d.platform, seen: d.lastSeenAt ? agoWords((now.getTime() - new Date(d.lastSeenAt).getTime()) / 60_000) : "لسا" }))}
        missing={demo ? firebaseMissing({}) : firebaseMissing()}
        canLink={can(me.role, "owner_only")}
        waiting={status.waiting}
        held={status.held}
        gaveUp={status.gaveUp}
        demo={demo}
      />
      {mode && wf ? (
        <section id="mode" className="scroll-mt-24 space-y-3">
          <h2 className="text-base font-extrabold text-fg">صاحي ونايم</h2>
          <p className="text-sm text-fg-muted">جدول الليل، وشو بيشتغل وإنت نايم، وشو بيصحّيك.</p>
          <ModeSwitch initial={{ mode: mode.mode, since: mode.since, schedule: mode.schedule }} demo={demo} />
          <ModeSettings schedule={mode.schedule} night={mode.nightPermissions} wakeKinds={mode.wakeKinds} workflows={wf.cards.map((c) => ({ key: c.key, name: c.name }))} demo={demo} />
        </section>
      ) : null}
    </div>
  );
}
