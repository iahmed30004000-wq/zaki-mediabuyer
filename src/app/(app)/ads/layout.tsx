import { PlaceTabs } from "@/components/shell/place-tabs";

export default function AdsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlaceTabs place="ads" />
      {children}
    </>
  );
}
