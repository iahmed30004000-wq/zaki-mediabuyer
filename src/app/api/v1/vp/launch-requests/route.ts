import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { contractResponse, requireToken, ContractError } from "@/server/api-token";
import { boundaryOf, MultipartError, readMultipart } from "@/server/multipart";
import { createLaunchRequest, incomingDir, resolveProductCode } from "@/server/studio-launch";
import { LaunchMetaSchema, MAX_VIDEO_BYTES } from "@/core/studio-launch";

export const dynamic = "force-dynamic";

/** the meta part carries a base64 thumbnail: a few MB at most */
const MAX_FIELD_BYTES = 6 * 1024 * 1024;
/** what the multipart framing and the meta part add on top of the video */
const SLACK_BYTES = MAX_FIELD_BYTES + 1024 * 1024;

/**
 * POST /api/v1/vp/launch-requests — the studio's finished video + its meta (contract §4.2 #2). It launches NOTHING: the
 * file feeds the normal intake (worker `studio.launch`), and the owner launches from the wizard and approves on the site.
 * The body is never buffered (`req.formData()` would hold up to 500 MB): it streams to disk through a sha256, and the size
 * limit is checked on Content-Length first and again while reading (ENGINEER_ONBOARDING F-10).
 */
export async function POST(req: Request) {
  const tmp = path.join(incomingDir(), `${randomUUID()}.part`);
  try {
    await requireToken(req, "vp:launch");
    const boundary = boundaryOf(req.headers.get("content-type"));
    if (!boundary || !req.body) throw new ContractError(422, "invalid_meta", "الطلب لازم يكون multipart/form-data فيه video و meta");
    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_VIDEO_BYTES + SLACK_BYTES) throw new ContractError(422, "video_too_large", "الفيديو أكبر من 500MB");

    let parts;
    try {
      parts = await readMultipart(Readable.fromWeb(req.body as never), boundary, { fileField: "video", filePath: tmp, maxFileBytes: MAX_VIDEO_BYTES, maxFieldBytes: MAX_FIELD_BYTES });
    } catch (e) {
      if (e instanceof MultipartError) {
        if (e.code === "file_too_large") throw new ContractError(422, "video_too_large", "الفيديو أكبر من 500MB");
        throw new ContractError(422, "invalid_meta", "الطلب مش مفهوم — لازم multipart/form-data سليم");
      }
      throw e;
    }
    if (!parts.file || parts.file.bytes === 0) throw new ContractError(422, "video_invalid", "ما وصل ملف فيديو بجزء اسمه video");

    let raw: unknown;
    try {
      raw = JSON.parse(parts.fields.meta ?? "");
    } catch {
      throw new ContractError(422, "invalid_meta", "جزء meta لازم يكون JSON");
    }
    const parsed = LaunchMetaSchema.safeParse(raw);
    if (!parsed.success) throw new ContractError(422, "invalid_meta", `meta ناقص أو غلط: ${parsed.error.issues.map((i) => i.path.join(".")).join(" · ")}`);
    const meta = parsed.data;
    if (!(await resolveProductCode(meta.vp_id))) throw new ContractError(422, "invalid_meta", "المنتج مش معروف عند الميديا باير — ضيفه بالإعدادات أو كاسم بديل");
    if (parts.file.sha256 !== meta.checksum_sha256) throw new ContractError(422, "checksum_mismatch", "بصمة الملف ما طابقت — ابعته من جديد");

    const { body } = await createLaunchRequest(meta, tmp);
    return NextResponse.json({ request_id: body.request_id, status: body.status, reason: body.reason, ops_url: body.ops_url });
  } catch (e) {
    return contractResponse(e);
  } finally {
    await rm(tmp, { force: true });
  }
}
