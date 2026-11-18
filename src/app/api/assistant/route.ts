import { NextResponse } from "next/server";
import { z } from "zod";
import { consult } from "@/agents/consultant";
import { LIMITS } from "@/core/assistant";
import { can } from "@/core/roles";
import { PrivacyRefusal } from "@/gateway/privacy";
import { AssistantError, askAssistant } from "@/server/assistant";
import { NO_KEY, OFF_BY_PRIVACY, assistantConfigured, assistantModel, externalModelsOff } from "@/server/assistant/config";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { isDemo } from "@/core/readiness";

export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().trim().min(1).max(LIMITS.question),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(4000) })).max(20).optional(),
  place: z.object({ key: z.string().max(20), label: z.string().max(40) }).nullable().optional(),
});

/** What the panel needs to know before the first question: is the assistant connected, and may this person save its drafts. */
export async function GET() {
  try {
    const caller = await requireCapability("assistant.use");
    const demo = isDemo(process.env);
    const on = (await assistantConfigured()) && !externalModelsOff();
    return NextResponse.json({
      mode: demo ? "demo" : on ? "assistant" : "consultant",
      model: on && !demo ? assistantModel() : null,
      notice: demo || on ? null : externalModelsOff() ? OFF_BY_PRIVACY : NO_KEY,
      canDraft: can(caller.role, "owner_only") && !caller.demo && !demo,
    });
  } catch (e) {
    return errorResponse(e);
  }
}

function failure(e: unknown): { status: number; message: string; code?: string } {
  if (e instanceof PrivacyRefusal) {
    const what = e.hits.map((h) => ({ phone: "رقم هاتف", email: "إيميل", token: "مفتاح" })[h]).join(" و");
    return { status: 422, message: `رسالتك فيها ${what} — ما بدخل بيانات زبون ولا مفاتيح للموديل. شيله وجرّب كمان مرة.`, code: "privacy" };
  }
  if (e instanceof AssistantError) return { status: e.status, message: e.message, code: e.code };
  if (e instanceof HttpError) return { status: e.status, message: e.message };
  console.error("[assistant]", e);
  return { status: 500, message: "صار خطأ، جرّب كمان مرة." };
}

/**
 * POST /api/assistant — the smart assistant (v3 · H). With a Claude key it answers from the screens' own numbers through tools,
 * streaming what it is doing (NDJSON: `status` lines, then one `final` or `error`). Without one — or while PRIVACY_MODE keeps
 * external models off — it falls back to the consultant: the code's facts, and an internal model's words if one is connected.
 * It never executes anything that spends: a proposed change waits for the owner on the site.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("assistant.use");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, `اكتب سؤالك (لحد ${LIMITS.question} حرف)`);
    const { question, history = [], place = null } = parsed.data;

    if (isDemo(process.env)) {
      return NextResponse.json({ mode: "demo", answer: "هاد الموقع على البيانات التجريبية، فالمساعد ما بيجاوب عن أرقام حقيقية. لما المالك يوقف الوضع التجريبي ويشتغل على أرقامك ويتوصل مفتاح Claude، بجاوبك من أرقامك: كل رقم بمصدره، وبعمل مهام ومسودات، وما بنفّذ صرف أبداً. هلأ جرّب «اشرح لي هالشاشة».", facts: [], sources: [], artifacts: [], verified: true, unsupported: [] });
    }

    if (!(await assistantConfigured()) || externalModelsOff()) {
      const c = await consult(question, place?.label ?? "");
      return NextResponse.json({
        mode: "consultant",
        by: c.by,
        answer: c.answer,
        facts: c.facts.map((line) => ({ label: line, value: "", raw: null, source: "code" })),
        sources: [],
        artifacts: [],
        verified: true,
        unsupported: [],
        notice: externalModelsOff() ? OFF_BY_PRIVACY : NO_KEY,
      });
    }

    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (o: unknown) => {
          try {
            controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
          } catch {
            // the person closed the panel: nobody is listening any more
          }
        };
        try {
          const reply = await askAssistant({ question, history, place }, caller, { onStatus: (text) => send({ type: "status", text }), signal: req.signal });
          send({ type: "final", reply });
        } catch (e) {
          send({ type: "error", ...failure(e) });
        } finally {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store, no-transform", "x-accel-buffering": "no" } });
  } catch (e) {
    return errorResponse(e);
  }
}
