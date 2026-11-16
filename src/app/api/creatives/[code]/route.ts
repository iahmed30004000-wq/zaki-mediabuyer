import { NextResponse } from "next/server";
import { missingText } from "@/core/readiness";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { driveFromEnv, listChildren, productFolders, renameMove } from "@/adapters/drive";

const Body = z.object({ action: z.enum(["approve", "exclude"]) });

/**
 * POST /api/creatives/:code {approve|exclude} — the owner's decision on a video waiting for him (yellow policy or a
 * failed file check). Approve → `ready` (moved to 02_ready on Drive); exclude → `excluded` (moved to excluded, never
 * deleted). A red (forbidden) video cannot be approved here: it needs an edited version.
 */
export async function POST(req: Request, { params }: { params: { code: string } }) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم");
    const caller = await requireCapability(parsed.data.action === "approve" ? "ads.approve_within_cap" : "ads.propose");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const asset = await db.creativeAsset.findUnique({ where: { crCode: params.code } });
    if (!asset) throw new HttpError(404, "الفيديو مش موجود");
    if (parsed.data.action === "approve" && asset.policyFlag === "red") throw new HttpError(409, "فيه ادعاء ممنوع — بدو نسخة معدّلة، ما بينوافق عليه");
    if (asset.status !== "review" && parsed.data.action === "approve") throw new HttpError(409, "هالفيديو مش بانتظار موافقة");
    const status = parsed.data.action === "approve" ? "ready" : "excluded";
    // the file sits on Drive: with no Drive link the move cannot happen, and saying «تمت» would be false — stop before anything changes
    if (asset.driveFileId && !(driveFromEnv() && process.env.DRIVE_PRODUCTS_FOLDER_ID?.trim())) throw new HttpError(409, `${missingText("drive") ?? "درايف مش مربوط"} (الفيديو على درايف، فنقله ما بيمشي بدونه)`);
    await db.creativeAsset.update({ where: { id: asset.id }, data: { status } });
    await db.policyCheck.updateMany({ where: { assetId: asset.id }, data: { approvedBy: caller.id } });

    // move the file on Drive too, when it came from there
    const drive = driveFromEnv();
    const root = process.env.DRIVE_PRODUCTS_FOLDER_ID;
    if (drive && root && asset.driveFileId) {
      for (const f of await productFolders(drive, root)) {
        const inInbox = (await listChildren(drive, f.inbox)).some((x) => x.id === asset.driveFileId);
        if (inInbox) {
          await renameMove(drive, asset.driveFileId, { from: f.inbox, to: status === "ready" ? f.ready : f.excluded });
          await db.driveFile.updateMany({ where: { driveId: asset.driveFileId }, data: { folder: status === "ready" ? "ready" : "excluded" } });
          break;
        }
      }
    }
    await audit({ type: "user", id: caller.id }, `creative.${parsed.data.action}`, { type: "creative", id: asset.crCode }, { before: { status: asset.status }, after: { status } });
    return NextResponse.json({ ok: true, status });
  } catch (e) {
    return errorResponse(e);
  }
}
