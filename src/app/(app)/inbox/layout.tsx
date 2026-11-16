import { PlaceTabs } from "@/components/shell/place-tabs";

export default function InboxLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlaceTabs place="inbox" />
      {children}
    </>
  );
}
