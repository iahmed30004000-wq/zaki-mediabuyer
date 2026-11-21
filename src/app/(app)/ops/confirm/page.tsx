import { ConfirmPage } from "@/components/ops/ops-sections";
import { requirePage } from "@/server/auth";

export const metadata = { title: "التأكيد" };
export const dynamic = "force-dynamic";

/** التشغيل ← التأكيد: the team, the reasons for rejection, the manager's comment, and the owner's limits for the flags. */
export default async function OpsConfirmPage() {
  await requirePage("ops.view");
  return <ConfirmPage />;
}
