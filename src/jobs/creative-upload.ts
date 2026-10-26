/**
 * meta.upload (spec 7.4, 13.6) — every `ready` video without a Meta video id goes to the ad account of its product's
 * market, under its registry name, by the resumable API; the asset becomes `uploaded` once Meta says the video is
 * ready. A failure retries on the next run; after 5 attempts the video is marked dead and the owner is alerted.
 * Dry-run (META_WRITE_MODE ≠ live): nothing is sent, the asset stays `ready`.
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { db } from "@/server/db";
import { writeMode } from "@/meta/write";
import { uploadVideo } from "@/meta/video-upload";
import { metaToken } from "./meta-sync";
import { storageDir } from "./creative-intake";

const MAX_ATTEMPTS = 5;

export async function uploadReadyCreatives(limit = 10) {
  const mode = writeMode();
  const token = mode === "live" ? await metaToken() : null;
  const assets = await db.creativeAsset.findMany({ where: { status: "ready", metaVideoId: null }, take: limit, orderBy: { dateIn: "asc" } });
  const stats = { candidates: assets.length, uploaded: 0, waiting: 0, failed: 0, dryRun: mode !== "live" || !token };
  if (stats.dryRun) return stats;

  for (const a of assets) {
    const file = a.fileName ? path.join(storageDir(), a.crCode, a.fileName) : null;
    if (!file || !existsSync(file)) {
      stats.failed++;
      continue;
    }
    const product = a.productCode ? await db.productEconomics.findUnique({ where: { productCode: a.productCode } }) : null;
    const account = (product && (await db.adAccount.findFirst({ where: { market: product.market } }))) ?? (await db.adAccount.findFirst());
    if (!account) break;
    const attempts = Number((a.notes ?? "").match(/upload_attempts=(\d+)/)?.[1] ?? 0);
    try {
      const r = await uploadVideo({ token: token! }, mode, account.metaId, file, a.fileName!);
      if (r.status === "ready") {
        await db.creativeAsset.update({ where: { id: a.id }, data: { metaVideoId: r.videoId, status: "uploaded" } });
        stats.uploaded++;
      } else {
        await db.creativeAsset.update({ where: { id: a.id }, data: { metaVideoId: r.videoId } });
        stats.waiting++;
      }
    } catch (e) {
      stats.failed++;
      const next = attempts + 1;
      const notes = `${(a.notes ?? "").replace(/\s*upload_attempts=\d+/, "")} upload_attempts=${next}`.trim();
      await db.creativeAsset.update({ where: { id: a.id }, data: { notes, ...(next >= MAX_ATTEMPTS ? { status: "dead" } : {}) } });
      if (next >= MAX_ATTEMPTS) await db.alert.create({ data: { kind: "creative.upload_dead", tone: "warn", text: `${a.crCode} ما انرفع لميتا بعد ${MAX_ATTEMPTS} محاولات: ${String(e).slice(0, 160)}`, href: "/creatives" } });
    }
  }
  return stats;
}
