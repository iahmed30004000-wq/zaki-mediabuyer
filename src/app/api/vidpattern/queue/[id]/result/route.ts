import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/server/db";
import { ContractError, contractResponse, requireToken } from "@/server/api-token";

/** {result:{…}} is the contract; the studio's queue_worker posts {status:"draft", draft:{…}} — both are taken. */
const Body = z
  .object({ result: z.record(z.unknown()).optional(), draft: z.record(z.unknown()).optional(), status: z.string().optional() })
  .refine((b) => b.result ?? b.draft, "result");

/**
 * POST /api/vidpattern/queue/:id/result — the studio hands back what it made for a request it claimed (token
 * vp:launch). It is a draft: the videos themselves arrive through the intake (creative.ready / Drive) as usual.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireToken(req, "vp:launch");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new ContractError(400, "invalid_meta", "النتيجة لازم تكون كائن JSON");
    const done = await db.creativeRequest.updateMany({ where: { id: params.id, status: "claimed" }, data: { status: "done", result: (parsed.data.result ?? parsed.data.draft) as object, leaseUntil: null } });
    if (!done.count) throw new ContractError(409, "not_claimed", "لازم تاخد الطلب قبل ما تسلّم نتيجته");
    const r = await db.creativeRequest.findUniqueOrThrow({ where: { id: params.id } });
    await db.alert.create({ data: { kind: "creative.request_done", tone: "info", text: `الاستديو خلّص طلب ${r.crCode ?? r.productCode} (${r.count} ${r.kind === "new_hooks" ? "هوكات" : "سكربت"}) — الفيديوهات بتوصل الوارد`, href: "/creatives" } });
    return NextResponse.json({ id: r.id, status: r.status });
  } catch (e) {
    return contractResponse(e);
  }
}
