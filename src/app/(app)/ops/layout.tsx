import { PlaceTabs } from "@/components/shell/place-tabs";

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlaceTabs place="ops" />
      {children}
    </>
  );
}
