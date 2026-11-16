import { ScaleLadder } from "@/components/pages/scale-ladder";

export const metadata = { title: "سلّم التكبير" };
export const dynamic = "force-dynamic";

/** الإعلانات ← سلّم التكبير: who may be raised, and why not the others. */
export default function AdsScalePage() {
  return <ScaleLadder />;
}
