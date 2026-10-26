import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { storageDir } from "@/jobs/creative-intake";

/** GET /api/creatives/:code/thumb/:n — a candidate thumbnail (signed-in only; files live in the private storage). */
export async function GET(_req: Request, { params }: { params: { code: string; n: string } }) {
  try {
    await requireCapability("view");
    const asset = await db.creativeAsset.findUnique({ where: { crCode: params.code }, include: { thumbnails: true } });
    const t = asset?.thumbnails.find((x) => x.frameIndex === Number(params.n));
    if (!t) throw new HttpError(404, "مش موجود");
    // only files inside the storage folder are ever served
    const root = path.resolve(storageDir());
    const file = path.resolve(t.path);
    if (!file.startsWith(root)) throw new HttpError(404, "مش موجود");
    return new Response(new Blob([await readFile(file)]), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch (e) {
    return errorResponse(e);
  }
}
