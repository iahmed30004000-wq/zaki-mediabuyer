import { CreativesView } from "@/components/creatives/creatives-view";
import { TabNav } from "@/components/shell/tab-nav";
import { BoardView } from "@/components/videos/board-view";
import { loadCreatives, loadDuplicates } from "@/lib/creatives-view";
import { loadDataset } from "@/lib/source";
import { loadBoard } from "@/lib/videos-board";
import { STAGE_FLOW } from "@/lib/mock/data";

export const metadata = { title: "الفيديوهات" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "board", label: "حسب المنتج" },
  { key: "flow", label: "المسار" },
] as const;

/**
 * الفيديوهات: two ways to look at the same videos — the board per product (the bank against 50, the winners, the tired, the
 * four buttons that ask Hermes) and the road each video walks from Drive to live to tired. The board is the first.
 */
export default async function VideosPage({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = searchParams.tab === "flow" ? "flow" : "board";
  if (tab === "board") {
    const board = await loadBoard();
    return (
      <div className="space-y-6">
        <TabNav tabs={TABS} active={tab} base="/videos" label="الفيديوهات" tour="tabs" />
        <BoardView data={board} />
      </div>
    );
  }
  const [creatives, duplicates, ds] = await Promise.all([loadCreatives(), loadDuplicates(), loadDataset()]);
  return (
    <div className="space-y-6">
      <TabNav tabs={TABS} active={tab} base="/videos" label="الفيديوهات" tour="tabs" />
      <CreativesView creatives={creatives} duplicates={duplicates} flow={STAGE_FLOW} products={ds.products.map((p) => ({ code: p.code, name: p.name }))} />
    </div>
  );
}
