import { Panel } from "@/components/mb/section";
import { ThemePicker } from "@/components/theme/theme-picker";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المظهر" };

/** الإعدادات ← المظهر: فاتح أو داكن. بيتبدّلوا فوراً وبيتذكّرهم المتصفح. */
export default async function LookPage() {
  await requirePage("settings.view");
  return (
    <Panel>
      <ThemePicker />
    </Panel>
  );
}
