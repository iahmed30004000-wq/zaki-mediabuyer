import { DataHealth } from "@/components/pages/data-health";
import { requirePage } from "@/server/auth";

export const metadata = { title: "صحة البيانات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← صحة البيانات: tracking, attribution and the safety of the accounts. */
export default async function AdsHealthPage() {
  await requirePage("ads.view");
  return <DataHealth />;
}
