/**
 * «اكتبها بجملة», the model's half (v6 · P4-2, docs/rebuild-v6/02-screens.md §3.7): the assistant has ONE tool for it, `draft_job`, whose input is the strict schema of a `JobDraft` and whose answer is a
 * card — it never saves, spends or touches Meta. Every check «مهمة جديدة» makes is made again on what the model wrote; what is wrong goes back to the model in words so it can fix the call; and the
 * model is never given a customer, a token or a phone number.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { toolSpecs, type Artifact } from "@/core/assistant";
import type { DirEntry } from "@/core/directory";
import { JobDraftSchema, type JobDraft } from "@/core/job-draft";
import { PrivacyRefusal } from "@/gateway/privacy";
import { resetRuns } from "@/server/assistant";
import { draftJobFromSentence } from "@/server/assistant/draft-job";
import type { Llm, LlmRequest, LlmResponse } from "@/server/assistant/loop";
import { makeTools, type ToolCtx } from "@/server/assistant/tools";

const NOW = new Date("2026-11-22T09:00:00Z"); // Sunday 12:00 on the Amman clock
const USAGE = { input_tokens: 1000, output_tokens: 100 };
const dir = (key: string, name: string, kind: "agent" | "person", active = true): DirEntry => ({ key, name, kind, team: null, userId: null, hasTelegram: false, active });
const DIRECTORY = [dir("claude", "Claude", "agent"), dir("hermes", "هيرمز", "agent"), dir("member1", "عضو الفريق", "person"), dir("site", "الموقع", "agent"), dir("gone", "راح", "person", false)];
const deps = { directory: async () => DIRECTORY, productCodes: async () => ["TIN01", "TRF01"] };

const owner = { id: "u1", role: "OWNER" as const, demo: false };
const ctx: ToolCtx = { caller: owner, now: NOW, place: null };
const tool = () => makeTools(deps).find((t) => t.name === "draft_job")!;

const draft = (over: Partial<JobDraft> = {}): JobDraft => ({
  name: "فحص المخزون",
  domain: "ops",
  assigneeKey: "claude",
  when: { kind: "daily", time: "09:30" },
  steps: [{ verb: "read", text: "اقرا المخزون" }, { verb: "decide", text: "إذا في منتج تحت الحد" }, { verb: "tell", text: "بلّغني" }],
  notifyOn: ["stuck", "missed", "failed"],
  ...over,
});
const run = (input: unknown) => tool().run(JobDraftSchema.parse(input), ctx);
const artifactOf = (o: { artifacts?: Artifact[] }) => o.artifacts?.find((a) => a.kind === "job_draft") as Extract<Artifact, { kind: "job_draft" }> | undefined;

describe("the tool and its schema", () => {
  it("is read-class (nothing is saved, so it needs no write grant) and its description is Arabic and says that nothing is saved", () => {
    const t = tool();
    expect(t.access).toBe("read");
    expect(t.status).toMatch(/…$/);
    expect(t.description).toMatch(/[؀-ۿ]/);
    expect(t.description).toContain("ما بيتحفظ شي");
  });

  it("the schema the model is given is the strict one of a draft: the same fields, the six kinds of «when», the seven verbs, the four recipes", () => {
    const spec = toolSpecs([tool()])[0]!;
    expect(spec.name).toBe("draft_job");
    const s = spec.input_schema as { properties: Record<string, unknown>; required: string[]; additionalProperties: boolean };
    expect(Object.keys(s.properties).sort()).toEqual(["assigneeKey", "domain", "name", "notifyOn", "recipe", "steps", "when"]);
    expect(s.required.sort()).toEqual(["assigneeKey", "domain", "name", "notifyOn", "steps", "when"]);
    expect(s.additionalProperties).toBe(false);
    const text = JSON.stringify(spec);
    for (const w of ["now", "once", "daily", "hourly", "weekly", "window"]) expect(text).toContain(`"${w}"`);
    for (const v of ["read", "compare", "decide", "do", "wait_me", "tell", "ask"]) expect(text).toContain(`"${v}"`);
    for (const r of ["stock_alert", "daily_summary", "remind", "metric_watch"]) expect(text).toContain(r);
  });

  it("nothing outside the schema gets in: an extra key, a made-up kind, a made-up verb, too many steps", () => {
    const bad = (over: Record<string, unknown>) => JobDraftSchema.safeParse({ ...draft(), ...over }).success;
    expect(bad({})).toBe(true);
    expect(bad({ secret: "x" })).toBe(false);
    expect(bad({ when: { kind: "monthly" } })).toBe(false);
    expect(bad({ when: { kind: "daily", time: "09:30", sneaky: 1 } })).toBe(false);
    expect(bad({ steps: [{ verb: "delete_campaign", text: "x" }] })).toBe(false);
    expect(bad({ steps: [{ verb: "read", text: "x", cmd: "rm" }] })).toBe(false);
    expect(bad({ steps: Array.from({ length: 21 }, () => ({ verb: "read", text: "x" })) })).toBe(false);
    expect(bad({ notifyOn: ["sms"] })).toBe(false);
    expect(bad({ recipe: { name: "free_steps", params: {} } })).toBe(false);
    expect(bad({ domain: "money" })).toBe(false);
  });
});

describe("what it does with a draft: a card, and nothing is saved", () => {
  it("a sound draft becomes a card with the draft and its sentence; the answer to the model says it is NOT saved", async () => {
    const out = await run(draft());
    expect(out.isError).toBeUndefined();
    const a = artifactOf(out)!;
    expect(a.draft).toMatchObject({ name: "فحص المخزون", assigneeKey: "claude" });
    expect(a.sentence).toBe("Claude · كل يوم 09:30 · 3 خطوات · بخبّرك لما توقف أو تفوت");
    expect(out.data).toMatchObject({ ok: true, saved: false, sentence: a.sentence });
    expect(JSON.stringify(out.data)).toContain("لسا ما انحفظ شي");
    expect(out.sources).toEqual([{ id: "jobs:new", label: "مهمة جديدة", href: "/tasks/new" }]);
  });

  it("never writes: no job, no task, no change, no request — the tool is given the directory and the product codes and nothing else", async () => {
    await run(draft());
    for (const name of ["workflow", "workflowVersion", "workflowRun", "handoff", "task", "approval", "notification"] as const) expect((h.db[name] as unknown as { rows: unknown[] }).rows, name).toHaveLength(0);
    const writing = ["create_task", "update_task", "propose_change"].map((n) => makeTools(deps).find((t) => t.name === n)!.access);
    expect(writing).toEqual(["write", "write", "write"]);
  });

  it("the draft that comes out is the normalised one (texts trimmed, the days in order) and a name is suggested when the model left it empty", async () => {
    const a = artifactOf(await run(draft({ name: "", steps: [{ verb: "read", text: "  اقرا المخزون  " }], when: { kind: "weekly", days: [4, 0], time: "09:30" } })))!;
    expect(a.draft.name).toBe("اقرا اقرا المخزون");
    expect(a.draft.steps[0]!.text).toBe("اقرا المخزون");
    expect(a.draft.when).toEqual({ kind: "weekly", days: [0, 4], time: "09:30" });
  });

  it("a recipe: «الموقع لحاله», no free steps, the parameters cleaned, the sentence names the recipe", async () => {
    const out = await run(draft({ name: "", assigneeKey: "site", steps: [], recipe: { name: "metric_watch", params: { metric: "spend", op: "above", limit: 150, junk: 1 } } }));
    const a = artifactOf(out)!;
    expect(a.draft.name).toBe("نبّهني لما رقم يعدّي حد: الصرف");
    expect(a.draft.recipe).toEqual({ name: "metric_watch", params: { metric: "spend", op: "above", limit: 150, product: "all", period: "yesterday" } });
    expect(a.sentence).toBe("الموقع لحاله · كل يوم 09:30 · نبّهني لما رقم يعدّي حد · بخبّرك لما توقف أو تفوت");
  });
});

describe("what it refuses — in words, so the model can fix the call", () => {
  const refused = async (over: Partial<JobDraft>, text: RegExp) => {
    const out = await run(draft(over));
    expect(out.isError, JSON.stringify(over)).toBe(true);
    expect(JSON.stringify(out.data)).toMatch(text);
    expect(artifactOf(out)).toBeUndefined();
  };

  it("a doer who is not in the directory (or is put away): the keys it may use are listed", async () => {
    await refused({ assigneeKey: "nobody" }, /ما في حدا بهالمفتاح «nobody»/);
    await refused({ assigneeKey: "gone" }, /المفاتيح: claude \(Claude\)، hermes \(هيرمز\)، member1 \(عضو الفريق — شخص\)، site/);
  });

  it("a time that has passed, a window that ended, a weekly job with no day", async () => {
    await refused({ when: { kind: "once", date: "2026-11-21", time: "09:00" } }, /when\.date: هالموعد فات/);
    await refused({ when: { kind: "window", everyHours: 2, until: "2026-11-21T20:00:00.000Z" } }, /when\.until/);
    await refused({ when: { kind: "weekly", days: [], time: "09:30" } }, /when\.days/);
    await refused({ when: { kind: "daily", time: "9:30" } }, /when\.time/);
  });

  it("the site with free steps, a recipe for somebody else, a recipe with blocks mixed in", async () => {
    await refused({ assigneeKey: "site" }, /assigneeKey/);
    await refused({ recipe: { name: "stock_alert", params: {} } }, /recipe: الوصفة بينفّذها الموقع لحاله/);
    await refused({ assigneeKey: "site", recipe: { name: "stock_alert", params: {} } }, /steps: الوصفة خطواتها ثابتة/);
  });

  it("a recipe that points at nothing: a product the site does not have, an agent to remind, a limit that is missing", async () => {
    await refused({ assigneeKey: "site", steps: [], recipe: { name: "stock_alert", params: { product: "ZZZ99" } } }, /recipe\.product: هالمنتج مش بين منتجاتك/);
    await refused({ assigneeKey: "site", steps: [], recipe: { name: "remind", params: { person: "claude", text: "x" } } }, /التذكير لشخص/);
    await refused({ assigneeKey: "site", steps: [], recipe: { name: "remind", params: { person: "gone", text: "x" } } }, /recipe\.person/);
    await refused({ assigneeKey: "site", steps: [], recipe: { name: "metric_watch", params: { metric: "spend", op: "above" } } }, /recipe\.limit: اكتب الحد/);
  });

  it("a repeating job for a person (a person cannot answer a run), a step that points backwards", async () => {
    await refused({ assigneeKey: "member1" }, /الشخص ما بيسجّل تشغيل/);
    await refused({ steps: [{ verb: "decide", text: "إذا", elseGoto: 0 }, { verb: "read", text: "x" }] }, /elseGoto/);
  });

  it("customer data in any text of the draft — a phone, an e-mail, a key — is refused (the draft is never shown or kept)", async () => {
    await refused({ steps: [{ verb: "tell", text: "اتصل على 0791234567" }] }, /رقم هاتف/);
    await refused({ name: "لـ zaki@example.com" }, /إيميل/);
    await refused({ assigneeKey: "site", steps: [], recipe: { name: "remind", params: { person: "member1", text: "كلّم 0791234567" } } }, /رقم هاتف/);
  });
});

describe("the whole thing, through the loop and the privacy filter", () => {
  const say = (text: string): LlmResponse => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: USAGE });
  const call = (input: unknown, id = "tu_1"): LlmResponse => ({ content: [{ type: "tool_use", id, name: "draft_job", input }], stop_reason: "tool_use", usage: USAGE });
  const script = (...answers: LlmResponse[]): Llm & { requests: LlmRequest[] } => {
    const requests: LlmRequest[] = [];
    return {
      requests,
      async create(req) {
        requests.push(structuredClone(req));
        return answers[Math.min(requests.length - 1, answers.length - 1)]!;
      },
    };
  };
  const hooks = (llm: Llm) => ({ llm, now: NOW, model: "claude-opus-5-5", products: async () => [{ code: "TIN01", name: "قطرة طنين الأذن" }], deps });

  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
    resetRuns();
    delete process.env.PRIVACY_MODE;
  });

  it("a sentence becomes a draft: the model is given ONE tool, the team and the products, and the draft comes back — nothing is saved", async () => {
    const llm = script(call(draft()), say("جهّزتها — راجعها"));
    const r = await draftJobFromSentence("كل يوم الساعة 9:30 خلّي Claude يقرا المخزون ويبلّغني", owner, hooks(llm));
    expect(r.draft).toMatchObject({ assigneeKey: "claude", when: { kind: "daily", time: "09:30" } });
    expect(r.sentence).toContain("كل يوم 09:30");
    expect(r.say).toBe("جهّزتها — راجعها");
    const first = llm.requests[0]!;
    expect(first.tools.map((t) => t.name)).toEqual(["draft_job"]);
    const system = first.system.map((b) => b.text).join("\n");
    expect(system).toContain("claude = Claude (وكيل)");
    expect(system).toContain("member1 = عضو الفريق (شخص)");
    expect(system).toContain("site = الموقع لحاله");
    expect(system).toContain("TIN01 = قطرة طنين الأذن");
    expect(system).toContain("2026-11-22");
    expect(system).not.toContain("gone");
    expect((h.db.workflow as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it("a draft that is wrong is told back to the model in words; it fixes the call and the second one is the draft", async () => {
    const llm = script(call(draft({ assigneeKey: "nobody" })), call(draft(), "tu_2"), say("تمام"));
    const r = await draftJobFromSentence("فحص المخزون", owner, hooks(llm));
    expect(r.draft?.assigneeKey).toBe("claude");
    const answer = JSON.stringify(llm.requests[1]!.messages.at(-1));
    expect(answer).toContain("ما في حدا بهالمفتاح");
    expect(answer).toContain("is_error");
  });

  it("a sentence with something missing: the model asks (no tool call), and there is no draft — the screen shows the question", async () => {
    const llm = script(say("مين بدّه ينفّذها؟"));
    const r = await draftJobFromSentence("ذكّرني بشي", owner, hooks(llm));
    expect(r.draft).toBeNull();
    expect(r.sentence).toBeNull();
    expect(r.say).toBe("مين بدّه ينفّذها؟");
  });

  it("nothing leaves with a customer's phone, an e-mail or a key in the sentence: refused before the model, and no money is held", async () => {
    const llm = script(say("x"));
    for (const s of ["ذكّر 0791234567 بكرا", "ابعت لـ a@b.com", `المفتاح sk-ant-${"a".repeat(32)}`]) {
      await expect(draftJobFromSentence(s, owner, hooks(llm))).rejects.toBeInstanceOf(PrivacyRefusal);
    }
    expect(llm.requests).toHaveLength(0);
    expect((h.db.agentRun as unknown as { rows: { agent: string }[] }).rows.filter((r) => r.agent.endsWith(".hold"))).toHaveLength(0);
  });

  it("only who may make a job: the manager yes; the ads manager, the analyst and the rest are refused before the model is called", async () => {
    const llm = script(call(draft()), say("تمام"));
    await expect(draftJobFromSentence("فحص", { id: "m1", role: "MANAGER", demo: false }, hooks(llm))).resolves.toMatchObject({ draft: expect.anything() });
    for (const role of ["ADS_MANAGER", "OPS_MANAGER", "ANALYST", "MEMBER", "VIEWER"] as const) {
      const none = script(say("x"));
      await expect(draftJobFromSentence("فحص", { id: `u-${role}`, role, demo: false }, hooks(none))).rejects.toMatchObject({ status: 403 });
      expect(none.requests).toHaveLength(0);
    }
  });

  it("the external model is off in the internal-only mode: refused plainly", async () => {
    process.env.PRIVACY_MODE = "internal_only";
    await expect(draftJobFromSentence("فحص", owner, hooks(script(say("x"))))).rejects.toMatchObject({ status: 403, code: "off" });
  });
});
