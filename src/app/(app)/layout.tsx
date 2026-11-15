import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { PageHeader } from "@/components/shell/page-header";
import { CommandPalette } from "@/components/shell/command-palette";
import { Consultant } from "@/components/shell/consultant";
import { ShellProvider } from "@/components/shell/shell-context";
import { EditPanel } from "@/components/customize/edit-panel";
import { ApprovalRinger } from "@/components/approvals/approval-ringer";
import { MissionProvider } from "@/components/mb/mission";
import { can } from "@/core/roles";
import { loadPages } from "@/lib/ui-view";
import { currentCaller } from "@/server/auth";

/** Every place: the side menu (desktop) or the bottom bar (phone), the page header, the assistant button — and, for the owner, «وضع التعديل». */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const [pages, me] = await Promise.all([loadPages(), currentCaller()]);
  // the pencil is the owner's, signed in: with sign-in switched off nothing can be saved, so nothing is offered
  const canEdit = !!me && !me.demo && can(me.role, "owner_only");
  return (
    <MissionProvider>
      <ShellProvider pages={pages} canEdit={canEdit}>
        <div className="flex min-h-dvh">
          <Sidebar />
          <div className="min-w-0 flex-1">
            <PageHeader />
            <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-6 md:pb-12">{children}</main>
          </div>
        </div>
        <Consultant />
        <CommandPalette />
        <ApprovalRinger />
        <BottomNav />
        <EditPanel />
      </ShellProvider>
    </MissionProvider>
  );
}
