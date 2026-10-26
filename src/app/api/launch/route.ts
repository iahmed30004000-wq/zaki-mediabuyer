import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { launch, prepareLaunch } from "@/server/launch";
import { MARKETS } from "@/core/naming";

const Body = z.object({
  preview: z.boolean().optional(),
  template: z.enum(["TEST", "CRT", "SCALE"]),
  productCode: z.string().regex(/^[A-Z]{3}\d{2}$/),
  market: z.enum(MARKETS),
  accountMetaId: z.string().min(3),
  pageMetaId: z.string().min(1),
  datasetMetaId: z.string().min(1),
  landingUrl: z.string().url(),
  lpCode: z.string().regex(/^LP\d$/),
  crCodes: z.array(z.string().regex(/^CR\d{5}$/)).min(1).max(30),
  message: z.string().min(1).max(2000),
  title: z.string().min(1).max(255),
  dailyBudgetUsd: z.number().positive().max(10_000).optional(),
  hypothesis: z.string().max(500).optional(),
});

/**
 * POST /api/launch — the wizard's last step. `preview: true` = «جرّب»: the name, the money per day and every reason
 * it would be refused, nothing stored. Otherwise one change set (test_campaign) waits for the owner, with its test.
 */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "في خانة ناقصة أو غلط بالإطلاق");
    const caller = await requireCapability("propose_change");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const { preview, ...input } = parsed.data;
    if (preview) {
      const p = await prepareLaunch(input);
      return NextResponse.json(p.ok ? { ok: true, name: p.name, perDay: p.perDay, dailyBudgetUsd: p.request.dailyBudgetUsd, ads: p.request.creatives.length, policy: p.policy.flag } : { ok: false, problems: p.problems });
    }
    const out = await launch(input, caller);
    return NextResponse.json({ ok: true, changeSetId: out.changeSet.id, state: out.changeSet.state, name: out.name, perDay: out.perDay, experimentId: out.experimentId });
  } catch (e) {
    return errorResponse(e);
  }
}
