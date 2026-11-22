/**
 * WHERE THE NUMBERS STAND (v6 · P5, docs/rebuild-v6/04-numbers.md §6): reads, once, the few facts the numbers depend on — is Meta linked and is there a spend row for yesterday, is
 * the OMS linked and when did it last REALLY answer, is there a stock reading, how many folders belong to no product — and hands them to `numbersReadiness` and to every tile.
 * Read-only: a few single-row queries; nothing is written, and a value is never a customer's. The demo site reports everything as there (a screen is real or it is demo).
 */
import { addDays, ammanKey, keyMs } from "@/core/dates";
import { isDemo } from "@/core/readiness";
import type { SourceFacts } from "@/core/numbers-readiness";
import { lastOmsSync } from "@/jobs/oms-health";
import { metaToken } from "@/jobs/meta-sync";
import { db } from "@/server/db";
import { omsLinked } from "@/server/env";

/** Letters of the Arabic block: a product name with none is a code written in Latin letters. */
const hasArabic = (s: string): boolean => /[؀-ۿ]/.test(s);

/** What the numbers of a window tell about the products: how many have no break-even point and how many have no Arabic name. */
export function productGaps(products: readonly { code: string; name: string; hasData: boolean; breakeven: number | null }[]): { withoutBreakeven: number; withoutName: number } {
  const shown = products.filter((p) => p.hasData);
  return { withoutBreakeven: shown.filter((p) => p.breakeven === null).length, withoutName: shown.filter((p) => !hasArabic(p.name)).length };
}

export async function loadSourceFacts(opts: { now?: Date; products?: readonly { code: string; name: string; hasData: boolean; breakeven: number | null }[] } = {}): Promise<SourceFacts> {
  const now = opts.now ?? new Date();
  const gaps = productGaps(opts.products ?? []);
  if (isDemo(process.env)) {
    return { now: now.toISOString(), metaLinked: true, metaLastSyncAt: now.toISOString(), spendYesterday: true, omsLinked: true, omsLastPullAt: now.toISOString(), productsWithoutBreakeven: gaps.withoutBreakeven, unmappedFolders: 0, productsWithoutName: gaps.withoutName, stockFresh: true };
  }
  const yesterday = new Date(keyMs(addDays(ammanKey(now), -1)));
  const [token, insight, pushed, oms, drive, stock, metaRun] = await Promise.all([
    metaToken().then((t) => t !== null, () => false),
    db.insightDaily.findFirst({ where: { date: yesterday }, select: { id: true } }),
    db.productDay.findFirst({ where: { date: yesterday, spend: { not: null } }, select: { id: true } }),
    db.jobRun.findMany({ where: { job: "oms.sync" }, orderBy: { startedAt: "desc" }, take: 48, select: { status: true, startedAt: true, finishedAt: true, stats: true } }),
    db.jobRun.findFirst({ where: { job: "drive.library", status: "ok" }, orderBy: { startedAt: "desc" }, select: { stats: true } }),
    db.stockSnapshot.findFirst({ where: { at: { gte: new Date(now.getTime() - 24 * 3_600_000) } }, select: { id: true } }),
    db.jobRun.findFirst({ where: { job: "meta.sync", status: "ok" }, orderBy: { startedAt: "desc" }, select: { finishedAt: true, startedAt: true } }),
  ]);
  const folders = (drive?.stats as { unmappedFolders?: unknown } | null)?.unmappedFolders;
  return {
    now: now.toISOString(),
    metaLinked: token,
    metaLastSyncAt: (metaRun?.finishedAt ?? metaRun?.startedAt)?.toISOString() ?? null,
    spendYesterday: !!insight || !!pushed,
    omsLinked: omsLinked(),
    omsLastPullAt: lastOmsSync(oms)?.toISOString() ?? null,
    productsWithoutBreakeven: gaps.withoutBreakeven,
    unmappedFolders: Array.isArray(folders) ? folders.length : 0,
    productsWithoutName: gaps.withoutName,
    stockFresh: !!stock,
  };
}
