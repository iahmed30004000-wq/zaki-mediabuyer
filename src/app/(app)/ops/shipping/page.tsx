import { ShippingPage } from "@/components/ops/ops-sections";
import { requirePage } from "@/server/auth";

export const metadata = { title: "الشحن" };
export const dynamic = "force-dynamic";

/** التشغيل ← الشحن: what did not land on the shipping, what is stuck and returned. Read only. */
export default async function OpsShippingPage() {
  await requirePage("ops.view");
  return <ShippingPage />;
}
