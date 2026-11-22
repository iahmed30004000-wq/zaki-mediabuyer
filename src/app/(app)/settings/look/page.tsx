import { Panel } from "@/components/mb/section";
import { NavChoice } from "@/components/settings/nav-choice";
import { ThemePicker } from "@/components/theme/theme-picker";
import { requirePage } from "@/server/auth";

export const metadata = { title: "المظهر" };

/** الإعدادات ← المظهر: فاتح أو داكن، وترتيب الأماكن (الجديد أو القديم). الفاتح والداكن بيتبدّلوا فوراً وبيتذكّرهم المتصفح. */
export default async function LookPage() {
  await requirePage("settings.view");
  return (
    <div className="space-y-4">
      <Panel>
        <ThemePicker />
      </Panel>
      <Panel>
        <NavChoice />
      </Panel>
    </div>
  );
}
