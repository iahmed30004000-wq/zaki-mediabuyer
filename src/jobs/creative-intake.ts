/**
 * creative.intake (spec 7.2, 13.6) — one video at a time, from Drive's 01_inbox or from the studio:
 *
 *   1. download to the work folder and probe (ffprobe): valid · 9:16/4:5/1:1 · ≥ 720p · sound · first frame not black
 *   2. MD5 → already in the registry: `excluded` with dup_of (never deleted) + an alert
 *   3. CR##### from the counter (never reused)
 *   4. one name everywhere: {PRODUCT}_CR#####_{md5[0:4]}.mp4 — renamed INSIDE Drive at once
 *   5. policy guard (code dictionary over the texts we have) → green: ready · yellow: waits for the owner · red: excluded
 *   6. six candidate thumbnails from the first 3 seconds
 *   7. move: 02_ready (green) · stays in 01_inbox (yellow, until approved) · excluded (red, duplicate, broken)
 * Everything is recorded in CreativeAsset (the permanent registry) and DriveFile (what was already seen).
 */
import { copyFile, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { crCode, creativeFileName, judgeProbe, thumbnailMoments } from "@/core/creative";
import { checkPolicy, policyNote } from "@/core/policy";
import { productFromLegacyName } from "@/core/naming";
import { extractFrames, md5File, probeVideo } from "@/media/probe";
import { download, productFolders, renameMove, type DriveOptions } from "@/adapters/drive";

export const storageDir = () => process.env.STORAGE_DIR || path.join(process.cwd(), ".data", "creatives");

export interface IntakeMeta {
  productCode: string | null;
  source: "drive" | "studio" | "manual";
  sourceRef?: string | null;
  driveFileId?: string | null;
  originalName: string;
  /** whatever text we have for the policy guard: the studio's script / ad copy, a transcript later */
  texts?: { adText?: string | null; transcript?: string | null; ocrText?: string | null; lpText?: string | null };
  tags?: { conceptId?: string; hookType?: string; style?: string; angle?: string; awareness?: string; dialect?: string };
}

export type IntakeOutcome =
  | { status: "ready" | "review" | "excluded"; crCode: string; fileName: string; reason?: string }
  | { status: "duplicate"; dupOf: string; reason: string }
  | { status: "broken"; reason: string };

/** The next CR number, atomically. */
export async function nextCreativeNumber(): Promise<string> {
  const row = await db.creativeCounter.upsert({ where: { id: 1 }, create: { id: 1, last: await currentMax() + 1 }, update: { last: { increment: 1 } } });
  return crCode(row.last);
}

async function currentMax(): Promise<number> {
  // the first time: start after the highest CR already in the registry (the studio may have linked some)
  const rows = await db.creativeAsset.findMany({ select: { crCode: true } });
  return rows.reduce((m, r) => Math.max(m, Number(r.crCode.replace(/\D/g, "")) || 0), 0);
}

/** Steps 1–6 for a file already on disk. Pure registry work; moving files on Drive is the caller's job. */
export async function processVideo(file: string, meta: IntakeMeta): Promise<IntakeOutcome> {
  const probe = await probeVideo(file);
  const judged = judgeProbe(probe);
  const md5 = await md5File(file);
  const twin = await db.creativeAsset.findUnique({ where: { md5 } });
  if (twin) {
    await db.alert.create({ data: { kind: "creative.duplicate", tone: "info", text: `«${meta.originalName}» نسخة طبق الأصل من ${twin.crCode} — انتقل لـ excluded وما انحذف.`, href: "/creatives" } });
    return { status: "duplicate", dupOf: twin.crCode, reason: `نسخة من ${twin.crCode}` };
  }
  if (!judged.ok && !probe.ok) return { status: "broken", reason: judged.problems.join(" · ") };

  const code = await nextCreativeNumber();
  const product = meta.productCode ?? "PRODUCT";
  const fileName = creativeFileName(product, code, md5);
  const policy = checkPolicy(meta.texts ?? {});
  const note = [policyNote(policy), judged.ok ? null : `فحص الملف: ${judged.problems.join(" · ")}`].filter(Boolean).join("\n") || null;
  const status: "ready" | "review" | "excluded" = policy.flag === "red" ? "excluded" : !judged.ok || policy.flag === "yellow" ? "review" : "ready";

  const asset = await db.creativeAsset.create({
    data: {
      crCode: code,
      productCode: meta.productCode,
      source: meta.source,
      sourceRef: meta.sourceRef ?? null,
      driveFileId: meta.driveFileId ?? null,
      status,
      fileName,
      md5,
      durationS: probe.durationS ? probe.durationS.toFixed(2) : null,
      aspect: judged.aspect,
      resolution: probe.width ? `${probe.width}x${probe.height}` : null,
      policyFlag: policy.flag,
      policyNote: note,
      probe: probe as unknown as Prisma.InputJsonValue,
      notes: `الاسم الأصلي: ${meta.originalName}`,
      ...meta.tags,
    },
  });
  await db.policyCheck.create({ data: { assetId: asset.id, adText: meta.texts?.adText ?? null, transcript: meta.texts?.transcript ?? null, ocrText: meta.texts?.ocrText ?? null, lpText: meta.texts?.lpText ?? null, codeHits: policy.hits as unknown as Prisma.InputJsonValue, flag: policy.flag } });

  const dir = path.join(storageDir(), code);
  await mkdir(dir, { recursive: true });
  // the work copy the upload job sends to Meta (MinIO on the server later — DECISIONS D5)
  if (status !== "excluded") await copyFile(file, path.join(dir, fileName));
  if (probe.ok && probe.durationS > 0) {
    const moments = thumbnailMoments(probe.durationS);
    const frames = await extractFrames(file, moments, dir);
    await db.thumbnailCandidate.createMany({ data: frames.map((p, i) => ({ assetId: asset.id, frameIndex: i + 1, atSeconds: moments[i]!, path: p })) });
  }
  return { status, crCode: code, fileName, reason: note ?? undefined };
}

/** The product a Drive folder belongs to: its code in the name, or an alias («كمأة» → TRF01). */
async function productOfFolder(name: string): Promise<string | null> {
  const products = await db.productEconomics.findMany();
  const aliases = await db.productAlias.findMany();
  const direct = products.find((p) => name.toUpperCase().includes(p.productCode));
  if (direct) return direct.productCode;
  return productFromLegacyName(name, products.map((p) => ({ code: p.productCode, name: p.name, aliases: aliases.filter((a) => a.productCode === p.productCode).map((a) => a.alias) })))?.code ?? null;
}

/** One pass over every product's 01_inbox. */
export async function intakeDrive(o: DriveOptions, rootId: string) {
  const stats = { seen: 0, ready: 0, review: 0, excluded: 0, duplicates: 0, broken: 0, failed: 0 };
  const work = path.join(os.tmpdir(), "mb-intake");
  await mkdir(work, { recursive: true });
  for (const f of await productFolders(o, rootId)) {
    const productCode = await productOfFolder(f.product.name);
    const { listChildren } = await import("@/adapters/drive");
    for (const item of await listChildren(o, f.inbox)) {
      if (!item.mimeType.startsWith("video/")) continue;
      const known = await db.driveFile.findUnique({ where: { driveId: item.id } });
      if (known && known.status !== "failed") continue; // a file waiting for approval stays in the inbox and is not re-processed
      stats.seen++;
      const local = path.join(work, `${item.id}${path.extname(item.name) || ".mp4"}`);
      try {
        await download(o, item.id, local);
        const out = await processVideo(local, { productCode, source: "drive", driveFileId: item.id, originalName: item.name });
        const base = { productCode, originalName: item.name };
        if (out.status === "duplicate" || out.status === "broken") {
          await renameMove(o, item.id, { from: f.inbox, to: f.excluded });
          await db.driveFile.upsert({ where: { driveId: item.id }, create: { driveId: item.id, ...base, folder: "excluded", status: "excluded", error: out.reason }, update: { folder: "excluded", status: "excluded", error: out.reason } });
          if (out.status === "duplicate") stats.duplicates++;
          else stats.broken++;
          continue;
        }
        const to = out.status === "ready" ? f.ready : out.status === "excluded" ? f.excluded : undefined;
        await renameMove(o, item.id, { name: out.fileName, ...(to ? { from: f.inbox, to } : {}) });
        await db.driveFile.upsert({
          where: { driveId: item.id },
          create: { driveId: item.id, ...base, newName: out.fileName, folder: to === f.ready ? "ready" : to === f.excluded ? "excluded" : "inbox", status: "processed", crCode: out.crCode },
          update: { newName: out.fileName, folder: to === f.ready ? "ready" : to === f.excluded ? "excluded" : "inbox", status: "processed", crCode: out.crCode, error: null },
        });
        stats[out.status]++;
      } catch (e) {
        stats.failed++;
        await db.driveFile.upsert({ where: { driveId: item.id }, create: { driveId: item.id, productCode, originalName: item.name, folder: "inbox", status: "failed", error: String(e).slice(0, 500) }, update: { status: "failed", error: String(e).slice(0, 500) } });
      } finally {
        await rm(local, { force: true });
      }
    }
  }
  return stats;
}
