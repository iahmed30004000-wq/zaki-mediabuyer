import { GuideBody } from "@/components/pages/guide-body";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الدليل" };

/** الإعدادات ← متقدّم ← الدليل: الأماكن، الأسئلة اللي بتتكرر، وكل رقم من وين. */
export default async function GuidePage() {
  await requirePage("settings.view");
  return <GuideBody />;
}
