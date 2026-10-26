import { Sidebar } from "@/components/shell/sidebar";
import { BottomNav } from "@/components/shell/bottom-nav";
import { PageHeader } from "@/components/shell/page-header";
import { Consultant } from "@/components/shell/consultant";
import { MissionProvider } from "@/components/mb/mission";

/** Every place: the side menu (desktop) or the bottom bar (phone), the page header, the consultant button. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MissionProvider>
      <div className="flex min-h-dvh">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <PageHeader />
          <main className="mx-auto max-w-6xl px-4 pb-28 pt-4 md:px-6 md:pb-12">{children}</main>
        </div>
      </div>
      <Consultant />
      <BottomNav />
    </MissionProvider>
  );
}
