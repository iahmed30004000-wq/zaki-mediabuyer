import { DataHealth } from "@/components/pages/data-health";

export const metadata = { title: "صحة البيانات" };
export const dynamic = "force-dynamic";

/** الإعلانات ← صحة البيانات: tracking, attribution and the safety of the accounts. */
export default function AdsHealthPage() {
  return <DataHealth />;
}
