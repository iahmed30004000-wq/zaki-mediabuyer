import { Panel } from "@/components/mb/section";
import { ThemePicker } from "@/components/theme/theme-picker";

export const metadata = { title: "المظهر" };

/** الإعدادات ← المظهر: فاتح أو داكن. بيتبدّل فوراً وبيتذكّره المتصفح. */
export default function LookPage() {
  return (
    <Panel>
      <ThemePicker />
    </Panel>
  );
}
