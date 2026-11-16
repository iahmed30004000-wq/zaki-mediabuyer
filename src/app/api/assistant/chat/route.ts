import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { ChatBody, clearChat, loadChat, saveChat } from "@/server/assistant/chat";

export const dynamic = "force-dynamic";

const kept = (caller: { demo?: boolean }) => !caller.demo && process.env.MOCK_MODE !== "1";

/** GET /api/assistant/chat — the conversation this person left in the panel (nothing on the demo). */
export async function GET() {
  try {
    const caller = await requireCapability("view");
    return NextResponse.json({ messages: kept(caller) ? await loadChat(caller.id) : [] });
  } catch (e) {
    return errorResponse(e);
  }
}

/** PUT /api/assistant/chat `{ messages }` — keeps the last of them (what the panel shows). A phone number, an e-mail or a key in any of them: nothing is kept. */
export async function PUT(req: Request) {
  try {
    const caller = await requireCapability("view");
    const parsed = ChatBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "المحادثة مش مفهومة");
    if (!kept(caller)) return NextResponse.json({ ok: true, demo: true });
    if (!(await saveChat(caller.id, parsed.data.messages))) throw new HttpError(422, "المحادثة فيها رقم هاتف أو إيميل أو مفتاح — ما انحفظت");
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}

/** DELETE /api/assistant/chat — «محادثة جديدة»: what was kept goes. */
export async function DELETE() {
  try {
    const caller = await requireCapability("view");
    if (kept(caller)) await clearChat(caller.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
