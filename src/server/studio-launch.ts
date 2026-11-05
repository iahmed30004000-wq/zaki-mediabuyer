/**
 * The studio's launch requests (docs/STUDIO_DATA_CONTRACT_AR.md §4.2 #2–5, HANDOFF E1). The API stores the upload; the
 * worker (`studio.launch`, every 15 min) runs it through the normal intake; the status the studio reads is derived live
 * from the creative and the launch change set (src/core/studio-launch.ts). Nothing here touches Meta, and nothing here
 * can approve anything: the owner launches from the wizard, and approves on the website.
 */
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LaunchRequest as LaunchRequestRow, Prisma } from "@prisma/client";
import { db } from "./db";
import { ContractError } from "./api-token";
import { storageDir, processVideo } from "@/jobs/creative-intake";
import { CANCELLABLE, deriveStatus, duplicateDecision, productCodeOf, productFacts, type LaunchMeta, type LaunchStatus } from "@/core/studio-launch";

export const incomingDir = () => path.join(storageDir(), "incoming");
const opsUrl = () => `${(process.env.APP_URL?.trim() || "https://mediabuyer.zakiai.io").replace(/\/+$/, "")}/creatives`;

/** Our product code for a studio script id: the code inside it, or an alias (`VP-kama-109-v2` → «kama» → TRF01). */
export async function resolveProductCode(vpId: string): Promise<string | null> {
  const direct = productCodeOf(vpId);
  if (direct) return direct;
  const seg = vpId.split("-")[1];
  if (!seg) return null;
  const alias = await db.productAlias.findFirst({ where: { alias: { equals: seg, mode: "insensitive" } } });
  return alias?.productCode ?? null;
}

export interface RequestBody {
  request_id: string;
  status: LaunchStatus;
  reason: string | null;
  error_code: string | null;
  ops_url: string;
  campaign_id: string | null;
  adset_id: string | null;
  ad_id: string | null;
  landing_page_id: string | null;
}

/** The linked change set: the one the wizard linked, else the newest test campaign that creates an ad named with this CR. */
async function linkedChange(r: LaunchRequestRow) {
  if (r.changeSetId) return db.changeSet.findUnique({ where: { id: r.changeSetId }, include: { items: true } });
  if (!r.crCode) return null;
  return db.changeSet.findFirst({
    where: { kind: "test_campaign", items: { some: { op: "create", objectType: "ad", after: { path: ["name"], string_contains: r.crCode } } } },
    orderBy: { createdAt: "desc" },
    include: { items: true },
  });
}

export async function statusOf(r: LaunchRequestRow): Promise<RequestBody> {
  const asset = r.crCode ? await db.creativeAsset.findUnique({ where: { crCode: r.crCode } }) : null;
  const cs = await linkedChange(r);
  const { status, reason } = deriveStatus(r, asset, cs);
  let ids = { campaign_id: null as string | null, adset_id: null as string | null, ad_id: null as string | null };
  if (status === "launched" && cs) {
    const made = cs.items.filter((i) => i.op === "create");
    const pick = (t: string) => made.find((i) => i.objectType === t)?.objectId ?? null;
    const ad = made.find((i) => i.objectType === "ad" && r.crCode && String((i.after as { name?: string }).name ?? "").includes(r.crCode));
    ids = { campaign_id: pick("campaign"), adset_id: pick("adset"), ad_id: ad?.objectId ?? pick("ad") };
  }
  return { request_id: r.id, status, reason, error_code: status === "failed" || status === "rejected" ? r.errorCode : null, ops_url: opsUrl(), ...ids, landing_page_id: null };
}

/** The newest request of this script and mode, with its derived status (for the dedupe). */
async function latestFor(vpId: string, mode: string) {
  const r = await db.launchRequest.findFirst({ where: { vpId, mode }, orderBy: { createdAt: "desc" } });
  return r ? { row: r, body: await statusOf(r) } : null;
}

/**
 * Registers a request whose file is already on disk at `tmpFile` (same volume as `incoming/`) with its checksum verified.
 * `same` → the earlier request is answered and the new file is dropped; `conflict` → 409.
 */
export async function createLaunchRequest(meta: LaunchMeta, tmpFile: string): Promise<{ request: LaunchRequestRow; body: RequestBody; repeated: boolean }> {
  const earlier = await latestFor(meta.vp_id, meta.mode);
  const decision = duplicateDecision(earlier ? { status: earlier.body.status, checksum: earlier.row.checksum } : null, meta.checksum_sha256);
  if (decision === "same") {
    await rm(tmpFile, { force: true });
    return { request: earlier!.row, body: earlier!.body, repeated: true };
  }
  if (decision === "conflict") {
    await rm(tmpFile, { force: true });
    throw new ContractError(409, "duplicate_request", "في طلب لنفس الفيديو لسا ما خلص ببصمة ثانية — الغيه أول أو استنى يخلص");
  }
  const id = randomUUID();
  const dest = path.join(incomingDir(), `${id}.mp4`);
  await mkdir(incomingDir(), { recursive: true });
  await rename(tmpFile, dest);
  const { thumbnail: _thumbnail, ...rest } = meta;
  void _thumbnail;
  const request = await db.launchRequest.create({ data: { id, vpId: meta.vp_id, mode: meta.mode, checksum: meta.checksum_sha256, filePath: dest, meta: rest as Prisma.InputJsonValue } });
  return { request, body: await statusOf(request), repeated: false };
}

/** The worker: every stored upload goes through the normal intake once. Never touches Drive. */
export async function processPendingRequests(): Promise<{ processed: number; linked: number; duplicates: number; broken: number; failed: number }> {
  const stats = { processed: 0, linked: 0, duplicates: 0, broken: 0, failed: 0 };
  const pending = await db.launchRequest.findMany({ where: { filePath: { not: null }, crCode: null, closedStatus: null }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const r of pending) {
    const meta = r.meta as unknown as Omit<LaunchMeta, "thumbnail">;
    try {
      const already = await db.creativeAsset.findUnique({ where: { sourceRef: r.vpId } });
      if (already) {
        await db.launchRequest.update({ where: { id: r.id }, data: { crCode: already.crCode, filePath: null } });
        stats.linked++;
      } else {
        const out = await processVideo(r.filePath!, {
          productCode: await resolveProductCode(r.vpId),
          source: "studio",
          sourceRef: r.vpId,
          originalName: r.vpId,
          texts: { adText: meta.script_text, transcript: meta.script_text, ocrText: meta.captions_srt },
          tags: { dialect: meta.dialect },
        });
        if (out.status === "duplicate") {
          await db.launchRequest.update({ where: { id: r.id }, data: { closedStatus: "rejected", reason: out.reason, errorCode: "duplicate_request", filePath: null } });
          stats.duplicates++;
        } else if (out.status === "broken") {
          await db.launchRequest.update({ where: { id: r.id }, data: { closedStatus: "failed", reason: out.reason, errorCode: "video_invalid", filePath: null } });
          stats.broken++;
        } else {
          await db.launchRequest.update({ where: { id: r.id }, data: { crCode: out.crCode, filePath: null } });
        }
        stats.processed++;
      }
      await rm(r.filePath!, { force: true });
    } catch (e) {
      // left as it is: the next quarter tries again, and the studio keeps seeing «received»
      console.error("studio.launch", r.id, e);
      stats.failed++;
    }
  }
  return stats;
}

/** Cancel before the owner approves. A launch change set waiting for the owner is NOT touched: the owner decides it. */
export async function cancelRequest(id: string): Promise<{ request_id: string; status: "cancelled" }> {
  const r = await db.launchRequest.findUnique({ where: { id } });
  if (!r) throw new ContractError(404, "not_found", "الطلب مش موجود");
  const { status } = await statusOf(r);
  if (!(CANCELLABLE as readonly string[]).includes(status)) {
    throw new ContractError(409, "cannot_cancel", status === "launched" ? "الطلب انطلق خلص — ما بينلغي من هون" : `ما بينلغي: حالته «${status}»`);
  }
  await db.launchRequest.update({ where: { id }, data: { closedStatus: "cancelled", reason: "ألغاه الاستوديو", filePath: null } });
  if (r.filePath) await rm(r.filePath, { force: true });
  return { request_id: id, status: "cancelled" };
}

/** `GET product-market` / `products/{id}/facts`: only what we know, from `ProductEconomics` (never invented). */
export async function productMarketFacts(product: string | null, country: string | null) {
  if (!product) throw new ContractError(404, "not_found", "حدد المنتج (product=)");
  const key = product.trim();
  let code = /^[A-Z]{3}\d{2}$/.test(key.toUpperCase()) ? key.toUpperCase() : null;
  if (!code) code = (await db.productAlias.findFirst({ where: { alias: { equals: key, mode: "insensitive" } } }))?.productCode ?? null;
  const e = code ? await db.productEconomics.findUnique({ where: { productCode: code } }) : null;
  if (!e) throw new ContractError(404, "not_found", "المنتج مش معروف عند الميديا باير");
  const facts = productFacts(e, country && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null);
  if (!facts) throw new ContractError(404, "not_found", "ما عنا حقائق لهالمنتج بهالسوق");
  return facts;
}
