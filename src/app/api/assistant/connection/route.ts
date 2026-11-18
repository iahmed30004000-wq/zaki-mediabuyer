import { NextResponse } from "next/server";
import { z } from "zod";
import { connectionStatus, recheckKey, removeKey, saveKey } from "@/server/assistant/connection";
import { errorResponse, requireCapability } from "@/server/auth";

export const dynamic = "force-dynamic";

const Body = z.union([z.object({ action: z.literal("link"), apiKey: z.string().max(500) }), z.object({ action: z.literal("check") }), z.object({ action: z.literal("unlink") })]);

/** GET /api/assistant/connection — is Claude linked, from where (Coolify or the site), and the key's last four. Never the key. Owner only. */
export async function GET() {
  try {
    await requireCapability("owner_only");
    return NextResponse.json(await connectionStatus());
  } catch (e) {
    return errorResponse(e);
  }
}

/** POST /api/assistant/connection — {action:"link", apiKey} · {action:"check"} · {action:"unlink"}. Owner only; the key is tested with Anthropic, then stored encrypted. */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "الطلب مش مفهوم" }, { status: 400 });
    const b = parsed.data;
    const status = b.action === "link" ? await saveKey(caller, b.apiKey) : b.action === "check" ? await recheckKey(caller) : await removeKey(caller);
    return NextResponse.json(status);
  } catch (e) {
    return errorResponse(e);
  }
}
