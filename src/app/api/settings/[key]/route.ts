import { NextResponse } from "next/server";
import { z, type ZodType } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { setSetting, type SettingKey } from "@/server/settings";

const money = z.number().finite().min(0).max(100_000);
const code = z.string().regex(/^[A-Z]{3}\d{2}$/);

/** The settings the owner edits from the site, each with its own check (spec 13.5: every change is a new version). */
const EDITABLE: Partial<Record<SettingKey, ZodType>> = {
  "budget.split": z
    .object({ scale: z.number().min(0).max(1), test: z.number().min(0).max(1), new: z.number().min(0).max(1) })
    .refine((v) => Math.abs(v.scale + v.test + v.new - 1) < 0.001, "المجموع لازم يكون 100%"),
  "scale.product_caps": z.record(code, money),
  "landing.pages": z
    .array(z.object({ productCode: code, lpCode: z.string().regex(/^LP\d$/), url: z.string().url().startsWith("https://") }))
    .max(60)
    .refine((list) => new Set(list.map((l) => `${l.productCode}:${l.lpCode}`)).size === list.length, "نفس صفحة الهبوط مكررة لنفس المنتج"),
  "capi.purchase_on": z.enum(["confirmed", "delivered"]),
  "agents.daily_caps": z.record(z.string().regex(/^[MH]\d{2}$/), z.number().min(0).max(50)),
  "agents.monthly_cap": z.number().min(0).max(1000),
};

/** POST /api/settings/:key {value} — the owner changes one setting; the old one stays as a version to go back to. */
export async function POST(req: Request, { params }: { params: { key: string } }) {
  try {
    const key = decodeURIComponent(params.key) as SettingKey;
    const schema = EDITABLE[key];
    if (!schema) throw new HttpError(404, "هالإعداد ما بيتعدّل من الموقع");
    const caller = await requireCapability("owner_only");
    const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
    const parsed = schema.safeParse(body?.value);
    if (!parsed.success) throw new HttpError(400, parsed.error.issues[0]?.message ?? "القيمة مش صحيحة");
    if (process.env.MOCK_MODE === "1") return NextResponse.json({ ok: true, demo: true });
    const version = await setSetting(key, parsed.data, caller.id);
    return NextResponse.json({ ok: true, version });
  } catch (e) {
    return errorResponse(e);
  }
}
