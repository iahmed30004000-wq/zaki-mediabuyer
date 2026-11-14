import { CreativesView } from "@/components/creatives/creatives-view";
import { loadCreatives, loadDuplicates } from "@/lib/creatives-view";
import { loadDataset } from "@/lib/source";
import { STAGE_FLOW } from "@/lib/mock/data";

export const metadata = { title: "الفيديوهات" };
export const dynamic = "force-dynamic";

export default async function VideosPage() {
  const [creatives, duplicates, ds] = await Promise.all([loadCreatives(), loadDuplicates(), loadDataset()]);
  return <CreativesView creatives={creatives} duplicates={duplicates} flow={STAGE_FLOW} products={ds.products.map((p) => ({ code: p.code, name: p.name }))} />;
}
