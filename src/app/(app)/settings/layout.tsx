import { SettingsCrumb } from "@/components/settings/settings-crumb";

/** Every settings address: the way back and the page's name above it. */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <SettingsCrumb />
      {children}
    </div>
  );
}
