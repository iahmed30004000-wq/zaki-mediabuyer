/**
 * creative.intake.studio (spec 7.1, 9.4, 9.5; STUDIO_DATA_CONTRACT_AR §4.5) — the studio files its finished videos in the
 * owner's Drive by itself:  Zakiai / <product> / <VP-id> / 6-نهائي / <VP-id-vN>.mp4 . The owner shares «Zakiai» with the
 * service account (Viewer is enough) and puts its id in DRIVE_STUDIO_FOLDER_ID. This pass is READ ONLY there: nothing
 * is renamed, moved or deleted in the studio's tree — the registry holds our name, the studio keeps its own.
 *
 * Per ad folder only the highest version is taken (latestVersions). The CR number and name come from the same
 * `processVideo` as every other intake, with source «studio» and the VP id as `sourceRef`, so the studio's own
 * performance feed (/api/vidpattern/ad-performance) finds the ad again. A product folder the registry does not know
 * («kama» → TRF01 needs an alias) is skipped and said once a day — it is retried on the next pass.
 */
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db } from "@/server/db";
import { download, listChildren, type DriveOptions } from "@/adapters/drive";
import { latestVersions, vpIdOfFile } from "@/core/studio-contract";
import { processVideo, productOfFolder } from "./creative-intake";

/** Folders under the studio root that are not products. */
const NOT_PRODUCTS = new Set(["الأنماط", "مكتبة الصوت", "مشاريع حرة", "بلا منتج"]);
const FINAL = "نهائي";

export async function intakeStudioDrive(o: DriveOptions, rootId: string) {
  const stats = { products: 0, ads: 0, seen: 0, ready: 0, review: 0, excluded: 0, duplicates: 0, broken: 0, failed: 0, unmapped: [] as string[] };
  const work = path.join(os.tmpdir(), "mb-intake-studio");
  await mkdir(work, { recursive: true });
  for (const productFolder of await listChildren(o, rootId, true)) {
    if (NOT_PRODUCTS.has(productFolder.name)) continue;
    stats.products++;
    for (const adFolder of await listChildren(o, productFolder.id, true)) {
      const finalFolder = (await listChildren(o, adFolder.id, true)).find((f) => f.name.includes(FINAL));
      if (!finalFolder) continue;
      stats.ads++;
      const videos = (await listChildren(o, finalFolder.id)).filter((f) => f.mimeType.startsWith("video/"));
      for (const name of latestVersions(videos.map((v) => v.name))) {
        const item = videos.find((v) => v.name === name)!;
        const vpId = vpIdOfFile(item.name)!;
        const known = await db.driveFile.findUnique({ where: { driveId: item.id } });
        if (known && known.status !== "failed") continue;
        if (await db.creativeAsset.findUnique({ where: { sourceRef: vpId }, select: { id: true } })) continue;
        const codeInId = /^VP-(.+)-\d+-v\d+/.exec(vpId)?.[1] ?? "";
        const productCode = (await productOfFolder(productFolder.name)) ?? (codeInId ? await productOfFolder(codeInId) : null);
        if (!productCode) {
          if (!stats.unmapped.includes(productFolder.name)) stats.unmapped.push(productFolder.name);
          continue;
        }
        stats.seen++;
        const local = path.join(work, `${item.id}${path.extname(item.name) || ".mp4"}`);
        try {
          await download(o, item.id, local);
          const out = await processVideo(local, { productCode, source: "studio", sourceRef: vpId, driveFileId: item.id, originalName: item.name });
          if (out.status === "duplicate" || out.status === "broken") {
            await db.driveFile.upsert({ where: { driveId: item.id }, create: { driveId: item.id, productCode, originalName: item.name, folder: "studio", status: "excluded", error: out.reason }, update: { folder: "studio", status: "excluded", error: out.reason } });
            if (out.status === "duplicate") stats.duplicates++;
            else stats.broken++;
            continue;
          }
          await db.driveFile.upsert({ where: { driveId: item.id }, create: { driveId: item.id, productCode, originalName: item.name, newName: out.fileName, folder: "studio", status: "processed", crCode: out.crCode }, update: { newName: out.fileName, folder: "studio", status: "processed", crCode: out.crCode, error: null } });
          stats[out.status]++;
        } catch (e) {
          stats.failed++;
          await db.driveFile.upsert({ where: { driveId: item.id }, create: { driveId: item.id, productCode, originalName: item.name, folder: "studio", status: "failed", error: String(e).slice(0, 500) }, update: { status: "failed", error: String(e).slice(0, 500) } });
        } finally {
          await rm(local, { force: true });
        }
      }
    }
  }
  if (stats.unmapped.length) {
    const text = `مجلد الاستوديو «${stats.unmapped.join("، ")}» ما إله منتج معروف — ضيف اسم بديل للمنتج من الإعدادات وبيندخل الفيديو عالوارد لحاله`;
    const dup = await db.alert.findFirst({ where: { kind: "creative.studio_unmapped", text, createdAt: { gte: new Date(Date.now() - 86_400_000) } } });
    if (!dup) await db.alert.create({ data: { kind: "creative.studio_unmapped", tone: "warn", text, href: "/settings#products" } });
  }
  return stats;
}
