import { ConfirmPage } from "@/components/ops/ops-sections";

export const metadata = { title: "التأكيد" };
export const dynamic = "force-dynamic";

/** التشغيل ← التأكيد: the team, the reasons for rejection, the manager's comment, and the owner's limits for the flags. */
export default function OpsConfirmPage() {
  return <ConfirmPage />;
}
