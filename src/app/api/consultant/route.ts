import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { consult } from "@/agents/consultant";

const Body = z.object({ question: z.string().min(1).max(500), place: z.string().max(40) });

/** POST /api/consultant — M10: an answer from the code's facts, every number with its source; drafts only. */
export async function POST(req: Request) {
  try {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "اكتب سؤالك");
    await requireCapability("view");
    if (process.env.MOCK_MODE === "1") {
      return NextResponse.json({ answer: "بالوضع التجريبي ما في موديل موصول. بعد الربط بجاوبك من أرقامك، وكل رقم بمصدره (ميتا · حقيقي · تقدير)، ومسودات بس — ولا تنفيذ.", by: "code", facts: [] });
    }
    return NextResponse.json(await consult(parsed.data.question, parsed.data.place));
  } catch (e) {
    return errorResponse(e);
  }
}
