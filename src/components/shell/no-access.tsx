import { EmptyState } from "@/components/ui/card";

/** What an address answers to a role that may not open it (docs/rebuild/05-permissions.md §3). Not an error: nothing broke, it is just not theirs. */
export function NoAccess({ home }: { home: string }) {
  return <EmptyState title="هالصفحة مش من صلاحياتك" hint="إذا بتحتاجها، اطلبها من المالك." action={{ label: "ارجع لصفحتك", href: home }} />;
}
