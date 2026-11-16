import { notFound } from "next/navigation";
import { RingScreen } from "@/components/approvals/ring-screen";
import { listApprovals } from "@/server/approvals";
import { isDemo } from "@/core/readiness";

export const metadata = { title: "موافقة بانتظارك" };
export const dynamic = "force-dynamic";

/** The page a push opens: one request, full screen, four answers. A session is required (the middleware sends a signed-out person to the door first). */
export default async function RingPage({ params }: { params: { id: string } }) {
  if (isDemo(process.env)) notFound();
  const [approval] = await listApprovals({ ids: [params.id] });
  if (!approval) notFound();
  return <RingScreen approval={approval} ringing={approval.status === "pending" && approval.urgency === "red"} overlay={false} />;
}
