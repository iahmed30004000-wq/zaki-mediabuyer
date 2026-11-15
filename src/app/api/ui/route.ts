import { NextResponse } from "next/server";
import { UiOpSchema } from "@/core/customize";
import { applyOp, panelData } from "@/server/customize";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";

export const dynamic = "force-dynamic";

/** GET /api/ui — the owner's whole layout for the edit panel: pages, boards (with their tasks), fields (with their values), buttons, the workflows a button may run, and the merges worth doing. */
export async function GET() {
  try {
    const caller = await requireCapability("owner_only");
    if (caller.demo) return NextResponse.json({ demo: true });
    return NextResponse.json(await panelData());
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * POST /api/ui — one change from «وضع التعديل» (an op: src/core/customize.ts `UiOpSchema`). The owner only. A refusal says why in words
 * and changes nothing; an accepted change is a new version of the setting `ui.config`, so it can be put back. The answer carries the
 * panel's fresh data.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = UiOpSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, `طلب غير مفهوم: ${parsed.error.issues.slice(0, 2).map((i) => `${i.path.join(".") || "op"}: ${i.message}`).join(" · ")}`);
    // with no account to write for (sign-in switched off) nothing is saved
    if (caller.demo) return NextResponse.json({ ok: true, demo: true });
    const r = await applyOp(parsed.data, caller);
    return NextResponse.json({ ok: true, note: r.note, version: r.version, moved: r.moved, copied: r.copied, conflicts: r.conflicts, movedBack: r.movedBack, panel: await panelData() });
  } catch (e) {
    return errorResponse(e);
  }
}
