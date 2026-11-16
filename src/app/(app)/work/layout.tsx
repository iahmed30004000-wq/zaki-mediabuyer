import { PlaceTabs } from "@/components/shell/place-tabs";

export default function WorkLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PlaceTabs place="work" />
      {children}
    </>
  );
}
