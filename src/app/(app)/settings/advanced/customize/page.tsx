import { CustomizeHub } from "@/components/settings/customize-hub";
import { requirePage } from "@/server/auth";

export const metadata = { title: "التخصيص" };
export const dynamic = "force-dynamic";

/** الإعدادات ← متقدّم ← التخصيص: لوحات «مهام الفريق» وحقول بطاقاتها والمحذوفات (v6 · P8، Q5: غير هيك ما في تخصيص). */
export default async function CustomizePage() {
  await requirePage("settings.view");
  return <CustomizeHub />;
}
