import { CreativesView } from "@/components/creatives/creatives-view";
import { CREATIVES, PRODUCTS, STAGE_FLOW } from "@/lib/mock/data";

export const metadata = { title: "الإبداعات" };

export default function CreativesPage() {
  return <CreativesView creatives={CREATIVES} flow={STAGE_FLOW} products={PRODUCTS.map((p) => ({ code: p.code, name: p.name }))} />;
}
