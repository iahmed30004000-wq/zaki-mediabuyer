import { ScaleLadder } from "@/components/pages/scale-ladder";
import { requirePage } from "@/server/auth";

export const metadata = { title: "سلّم التكبير" };
export const dynamic = "force-dynamic";

/** الإعلانات ← سلّم التكبير: who may be raised, and why not the others. */
export default async function AdsScalePage() {
  await requirePage("ads.view");
  return <ScaleLadder />;
}
