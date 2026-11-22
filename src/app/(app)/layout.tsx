import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NoAccess } from "@/components/shell/no-access";
import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { PageHeader } from "@/components/shell/page-header";
import { CommandPalette } from "@/components/shell/command-palette";
import { Consultant } from "@/components/shell/consultant";
import { PeopleProvider } from "@/components/shell/people-context";
import { ShellProvider } from "@/components/shell/shell-context";
import { EditPanel } from "@/components/customize/edit-panel";
import { ApprovalRinger } from "@/components/approvals/approval-ringer";
import { MissionProvider } from "@/components/mb/mission";
import { ROLE_PLACES, ROLE_START, canOpenPath, can, capabilitiesOf, hasHome } from "@/core/roles";
import { isDemo } from "@/core/readiness";
import { countWaiting } from "@/lib/inbox-count";
import { loadPages } from "@/lib/ui-view";
import { currentCaller } from "@/server/auth";
import { loadDirectory } from "@/server/directory";

/** Every screen: the side menu (desktop) or the bottom bar (phone), the page header, and ONE line when the site is on the demo data. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await currentCaller();
  // a person who is not signed in goes to the door
  if (!me) redirect("/login");
  const [pages, inbox, directory] = await Promise.all([loadPages(), countWaiting(me), loadDirectory().catch(() => [])]);
  // a role sees only its own places (docs/rebuild/05-permissions.md §3): the bar hides the rest, and an address that is not theirs answers «هالصفحة مش من صلاحياتك»
  const path = headers().get("x-pathname") ?? "/";
  if (me && path === "/" && !hasHome(me.role)) redirect(ROLE_START[me.role]);
  const body = me && !canOpenPath(me.role, path) ? <NoAccess home={ROLE_START[me.role]} /> : children;
  // «وضع التعديل» is the owner's, signed in: with sign-in switched off nothing can be saved, so nothing is offered
  const canEdit = !!me && !me.demo && can(me.role, "owner_only");
  return (
    <MissionProvider>
      <PeopleProvider people={directory.map((d) => ({ key: d.key, label: d.name }))}>
      <ShellProvider pages={pages} canEdit={canEdit} inbox={inbox} places={me ? ROLE_PLACES[me.role] : undefined} settings={!me || can(me.role, "settings.view")} caps={me ? capabilitiesOf(me.role) : undefined}>
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <PageHeader />
            {isDemo(process.env) ? (
              <p role="status" className="border-b border-warn/30 bg-warn/10 px-4 py-1.5 text-center text-xs font-semibold text-warn">
                وضع تجريبي — الأرقام أمثلة
              </p>
            ) : null}
            <main className="mx-auto max-w-[1180px] px-4 pb-28 pt-4 md:px-6 md:pb-12">{body}</main>
          </div>
        </div>
        {!me || can(me.role, "assistant.use") ? <Consultant /> : null}
        <CommandPalette />
        <ApprovalRinger />
        <BottomNav />
        <EditPanel />
      </ShellProvider>
      </PeopleProvider>
    </MissionProvider>
  );
}
