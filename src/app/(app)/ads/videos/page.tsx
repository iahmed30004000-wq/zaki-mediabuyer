import { CreativesView } from "@/components/creatives/creatives-view";
import { BoardView } from "@/components/videos/board-view";
import { ButtonLink } from "@/components/ui/button-link";
import { can } from "@/core/roles";
import { loadCreatives, loadDuplicates } from "@/lib/creatives-view";
import { STAGE_FLOW } from "@/lib/mock/data";
import { loadDataset } from "@/lib/source";
import { loadEntityCustom } from "@/lib/ui-view";
import { loadBoard } from "@/lib/videos-board";
import { currentCaller } from "@/server/auth";

export const metadata = { title: "الفيديوهات" };
export const dynamic = "force-dynamic";

/**
 * الإعلانات ← الفيديوهات: two ways to look at the same videos — the board per product (the bank against 50, the winners, the tired)
 * and the road each video walks from Drive to live to tired. `?view=flow` is the road; the board is the first.
 */
export default async function VideosPage({ searchParams }: { searchParams: { view?: string } }) {
  const flow = searchParams.view === "flow";
  const switcher = (
    <div className="flex gap-2" data-tour="tabs">
      <ButtonLink href="/ads/videos" size="sm" variant={flow ? "ghost" : "secondary"}>
        البنك
      </ButtonLink>
      <ButtonLink href="/ads/videos?view=flow" size="sm" variant={flow ? "secondary" : "ghost"}>
        المسار
      </ButtonLink>
    </div>
  );
  if (!flow) {
    const [board, me] = await Promise.all([loadBoard(), currentCaller()]);
    const keys = board.products.flatMap((p) => [...p.winners, ...p.learning, ...p.rest].map((v) => v.key));
    const custom = await loadEntityCustom("video", keys);
    return (
      <div className="space-y-4">
        {switcher}
        <BoardView data={board} custom={custom} canEdit={!!me && !me.demo && can(me.role, "propose_change")} />
      </div>
    );
  }
  const [creatives, duplicates, ds] = await Promise.all([loadCreatives(), loadDuplicates(), loadDataset()]);
  return (
    <div className="space-y-4">
      {switcher}
      <CreativesView creatives={creatives} duplicates={duplicates} flow={STAGE_FLOW} products={ds.products.map((p) => ({ code: p.code, name: p.name }))} />
    </div>
  );
}
