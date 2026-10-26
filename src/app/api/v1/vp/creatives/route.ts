import { NextResponse } from "next/server";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { contractResponse, requireToken, ContractError } from "@/server/api-token";
import { isVpId } from "@/core/studio-contract";
import { processVideo } from "@/jobs/creative-intake";

export const dynamic = "force-dynamic";

const Body = z.object({
  url: z.string().url().refine((u) => u.startsWith("https://"), "https only"),
  product_code: z.string().regex(/^[A-Z]{3}\d{2}$/),
  vp_id: z.string().refine(isVpId, "VP-{code}-{n}-v{v}"),
  ad_text: z.string().max(5000).optional(),
  tags: z.object({ concept_id: z.string().optional(), hook: z.string().optional(), style: z.string().optional(), angle: z.string().optional(), awareness: z.string().optional(), dialect: z.string().optional() }).partial().optional(),
});

const MAX_BYTES = 500 * 1024 * 1024;

/**
 * POST /api/v1/vp/creatives — the studio's «creative.ready» (spec 9.4): a finished video by URL with its product, its
 * script id and its tags. The same intake as Drive: probe, MD5, CR number, name, policy, thumbnails. The answer is the
 * registry entry, so the studio learns its CR code at once. Idempotent on vp_id.
 */
export async function POST(req: Request) {
  try {
    await requireToken(req, "vp:launch");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ContractError(400, "bad_request", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · "));
    const b = parsed.data;
    const existing = await db.creativeAsset.findUnique({ where: { sourceRef: b.vp_id } });
    if (existing) return NextResponse.json({ cr_code: existing.crCode, status: existing.status, file_name: existing.fileName, policy: existing.policyFlag, repeated: true });

    const dir = path.join(os.tmpdir(), "mb-studio");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${randomUUID()}.mp4`);
    try {
      const res = await fetch(b.url, { redirect: "follow", signal: AbortSignal.timeout(600_000) });
      if (!res.ok || !res.body) throw new ContractError(422, "download_failed", `ما قدرت أنزّل الفيديو (${res.status})`);
      if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new ContractError(413, "too_large", "الفيديو أكبر من 500MB");
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
      const out = await processVideo(file, {
        productCode: b.product_code,
        source: "studio",
        sourceRef: b.vp_id,
        originalName: b.vp_id,
        texts: { adText: b.ad_text ?? null },
        tags: { conceptId: b.tags?.concept_id, hookType: b.tags?.hook, style: b.tags?.style, angle: b.tags?.angle, awareness: b.tags?.awareness, dialect: b.tags?.dialect },
      });
      if (out.status === "duplicate") return NextResponse.json({ status: "duplicate", dup_of: out.dupOf }, { status: 409 });
      if (out.status === "broken") return NextResponse.json({ status: "broken", reason: out.reason }, { status: 422 });
      return NextResponse.json({ cr_code: out.crCode, status: out.status, file_name: out.fileName, reason: out.reason ?? null });
    } finally {
      await rm(file, { force: true });
    }
  } catch (e) {
    return contractResponse(e);
  }
}
