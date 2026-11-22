/**
 * The assistant is never a way round a role, and never a way round the cap (v6 · P4-2, S-09 · S-24):
 *   • the tools a person is given are the ones their role may use — the model is not even told the others exist, and the consultant (the answer with no model) is for the roles that may read what it reads;
 *   • a person who looks after their own tasks is not told about everybody else's, and may not change them through the assistant;
 *   • one question at a time per person, and the money of a call is HELD before the call and settled after it, so two people asking at the same moment cannot both pass a cap only one fits under.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { ROLES, can, type RoleKey } from "@/core/roles";
import { NOT_YOUR_NUMBERS, TOOL_NEEDS, allowedTools, canConsult, toolAllowed, toolSpecs, type AssistantTool } from "@/core/assistant";
import { AssistantError, BUSY, HOLD_AGENT, HOLD_INPUT_TOKENS, RUN_TTL_MS, askAssistant, beginRun, endRun, holdUsd, reserveBudget, resetRuns, settleHold } from "@/server/assistant";
import type { Llm, LlmRequest, LlmResponse } from "@/server/assistant/loop";
import { makeTools, type ToolCtx } from "@/server/assistant/tools";

const NOW = new Date("2026-11-22T09:00:00Z");
const USAGE = { input_tokens: 1000, output_tokens: 100 };
const caller = (role: RoleKey, id = `u-${role}`) => ({ id, role, demo: false });
const say = (text: string): LlmResponse => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: USAGE });
const callTool = (name: string, input: unknown = {}): LlmResponse => ({ content: [{ type: "tool_use", id: `tu_${name}`, name, input }], stop_reason: "tool_use", usage: USAGE });
const scripted = (...answers: LlmResponse[]): Llm & { requests: LlmRequest[] } => {
  const requests: LlmRequest[] = [];
  return {
    requests,
    async create(req) {
      requests.push(structuredClone(req));
      return answers[Math.min(requests.length - 1, answers.length - 1)]!;
    },
  };
};
const ask = (role: RoleKey, llm: Llm, over: Record<string, unknown> = {}, id?: string) => askAssistant({ question: "كيف الوضع؟", history: [], place: null }, caller(role, id), { llm, now: NOW, model: "claude-opus-5-5", products: async () => [], ...over });

const ALL_TOOLS = ["calculate", "create_task", "draft_job", "draft_node", "draft_prompt", "draft_workflow", "edit_node", "explain", "get_ads", "get_changes", "get_day", "get_numbers", "get_overview", "get_summary", "get_tasks", "get_videos", "get_workflows", "propose_change", "update_task"];
const names = (role: RoleKey) => allowedTools(makeTools(), role).map((t) => t.name).sort();

beforeEach(() => {
  for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  resetRuns();
  delete process.env.PRIVACY_MODE;
});
afterEach(() => {
  resetRuns();
});

describe("who is given which tool", () => {
  it("the table has a row for every tool the assistant has — and for none it does not (a new tool is closed until somebody decides)", () => {
    expect(makeTools().map((t) => t.name).sort()).toEqual(ALL_TOOLS);
    expect(Object.keys(TOOL_NEEDS).sort()).toEqual(ALL_TOOLS);
    expect(toolAllowed("a_tool_nobody_decided_on", "MANAGER")).toBe(false);
    expect(toolAllowed("a_tool_nobody_decided_on", "OWNER")).toBe(true);
  });

  it("the owner and the manager have them all", () => {
    expect(names("OWNER")).toEqual(ALL_TOOLS);
    expect(names("MANAGER")).toEqual(ALL_TOOLS);
  });

  it("the ads manager: the ads, the money, the tasks of the team and a proposal — and not the drawing of a job or a new job", () => {
    expect(names("ADS_MANAGER")).toEqual(["calculate", "create_task", "draft_prompt", "explain", "get_ads", "get_changes", "get_day", "get_numbers", "get_overview", "get_summary", "get_tasks", "get_videos", "get_workflows", "propose_change", "update_task"]);
  });

  it("the operations manager: the operations numbers and the tasks — NOT the ads, the overview (money inside it) or a proposal on a campaign", () => {
    const n = names("OPS_MANAGER");
    expect(n).toEqual(["calculate", "create_task", "draft_prompt", "explain", "get_changes", "get_day", "get_numbers", "get_summary", "get_tasks", "get_workflows", "update_task"]);
    for (const no of ["get_ads", "get_videos", "get_overview", "propose_change"]) expect(n).not.toContain(no);
  });

  it("the analyst reads everything and proposes, but writes no task of anybody's: its tasks are its own", () => {
    const n = names("ANALYST");
    expect(n).toEqual(["calculate", "draft_prompt", "explain", "get_ads", "get_changes", "get_day", "get_numbers", "get_overview", "get_summary", "get_tasks", "get_videos", "get_workflows", "propose_change"]);
    expect(n).not.toContain("create_task");
    expect(n).not.toContain("update_task");
  });

  it("a role with no screen of its own gets no number at all (a viewer, a member)", () => {
    expect(names("MEMBER")).toEqual(["calculate", "draft_prompt", "explain", "get_tasks"]);
    expect(names("VIEWER")).toEqual(["calculate", "draft_prompt", "explain", "get_ads", "get_changes", "get_day", "get_numbers", "get_summary", "get_videos", "get_workflows"]);
    expect(names("VIEWER")).not.toContain("get_overview");
  });

  it("every tool a role is given is one its role holds the capability of: the table reads the same matrix as the screens", () => {
    for (const role of ROLES) {
      for (const t of makeTools()) {
        const need = TOOL_NEEDS[t.name]!;
        const ok = (need.all ?? []).every((c) => can(role, c)) && (!need.any?.length || need.any.some((c) => can(role, c)));
        expect(toolAllowed(t.name, role), `${role} · ${t.name}`).toBe(ok);
      }
    }
    // the tool that makes a job needs the capability that makes one on the screen
    expect(TOOL_NEEDS.draft_job).toEqual({ all: ["work.create"] });
    // writes need the capability of the thing they write
    expect(TOOL_NEEDS.create_task).toEqual({ all: ["tasks.manage"] });
    expect(TOOL_NEEDS.propose_change!.all).toContain("ads.propose");
  });

  it("the consultant (no model: the code's overview, money inside it) is for the roles that may read the ads and the money", () => {
    expect(ROLES.filter((r) => canConsult(r))).toEqual(["OWNER", "MANAGER", "ADS_MANAGER", "ANALYST"]);
    expect(NOT_YOUR_NUMBERS).toContain("دورك ما بيشوفها");
  });
});

describe("what the model is told, and what it may call", () => {
  it("the model is sent only the tools of the role — it cannot ask for what it does not know", async () => {
    const llm = scripted(say("تمام"));
    await ask("OPS_MANAGER", llm);
    const sent = llm.requests[0]!.tools.map((t) => t.name).sort();
    expect(sent).toEqual(names("OPS_MANAGER"));
    expect(sent).not.toContain("get_ads");
    const owner = scripted(say("تمام"));
    await ask("OWNER", owner, {}, "owner-1");
    expect(owner.requests[0]!.tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS);
  });

  it("a tool the role may not use, called by name anyway, is refused («مش موجودة»), and what it would have read never reaches the model", async () => {
    const ran = vi.fn();
    const spy: AssistantTool<ToolCtx> = { name: "get_ads", description: "ads", input: makeTools().find((t) => t.name === "get_ads")!.input, access: "read", status: "…", run: async (a, c) => (ran(a, c), { data: { secret_spend: 9999 }, sources: [], facts: [] }) };
    const llm = scripted(callTool("get_ads"), say("ما قدرت"));
    await ask("OPS_MANAGER", llm, { tools: [spy, ...makeTools().filter((t) => t.name !== "get_ads")] });
    expect(ran).not.toHaveBeenCalled();
    expect(JSON.stringify(llm.requests[1]!.messages)).toContain("مش موجودة");
    expect(JSON.stringify(llm.requests)).not.toContain("9999");
  });

  it("the specs the model reads are the same converter as before: nothing else changed in them", () => {
    const specs = toolSpecs(allowedTools(makeTools(), "ANALYST"));
    expect(specs.map((s) => s.name)).toContain("get_numbers");
    for (const s of specs) expect(s.input_schema).toMatchObject({ type: "object" });
  });
});

describe("the tasks of other people", () => {
  const tools = (keys: string[] | null, over: Record<string, unknown> = {}) =>
    makeTools({
      taskKeys: async () => keys,
      tasks: async () => [
        { id: "t1", title: "مهمتي", note: null, status: "new", assignee: "analyst1", executor: null, dueAt: null, priority: "normal", board: "main", linkType: null, linkId: null, source: "ui", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        { id: "t2", title: "مهمة غيري", note: null, status: "new", assignee: "other", executor: null, dueAt: null, priority: "normal", board: "main", linkType: null, linkId: null, source: "ui", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
        { id: "t3", title: "بلا مسؤول", note: null, status: "new", assignee: null, executor: null, dueAt: null, priority: "normal", board: "main", linkType: null, linkId: null, source: "ui", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() },
      ],
      boards: async () => [{ key: "main", label: "الرئيسية" }],
      ...over,
    });
  const ctx = (role: RoleKey): ToolCtx => ({ caller: caller(role), now: NOW, place: null });
  const getTasks = (keys: string[] | null, role: RoleKey) => tools(keys).find((t) => t.name === "get_tasks")!.run({}, ctx(role));

  it("a person who looks after their own tasks is told about those only (never one with nobody on it)", async () => {
    const out = await getTasks(["analyst1"], "ANALYST");
    const text = JSON.stringify(out.data);
    expect(text).toContain("مهمتي");
    expect(text).not.toContain("مهمة غيري");
    expect(text).not.toContain("بلا مسؤول");
  });

  it("a role that sees everybody's tasks is told about all of them", async () => {
    const text = JSON.stringify((await getTasks(null, "OPS_MANAGER")).data);
    for (const t of ["مهمتي", "مهمة غيري", "بلا مسؤول"]) expect(text).toContain(t);
  });

  it("changing a task through the assistant checks the same scope as the board: another's task is «مش مهمتك», and nothing is written", async () => {
    const updateTask = vi.fn();
    const { HttpError } = await import("@/server/auth");
    const run = makeTools({ updateTask: updateTask as never, tasksInScope: async () => { throw new HttpError(403, "هاي مهمة مش مهمتك"); } }).find((t) => t.name === "update_task")!;
    const out = await run.run({ id: "t2", status: "done" }, ctx("OPS_MANAGER"));
    expect(out.isError).toBe(true);
    expect(JSON.stringify(out.data)).toContain("هاي مهمة مش مهمتك");
    expect(updateTask).not.toHaveBeenCalled();
  });
});

describe("one question at a time per person", () => {
  it("a second turn for the same person is refused until the first ends; another person is not held up", () => {
    expect(beginRun("u1", 1_000)).toBe(true);
    expect(beginRun("u1", 1_500)).toBe(false);
    expect(beginRun("u2", 1_500)).toBe(true);
    endRun("u1");
    expect(beginRun("u1", 2_000)).toBe(true);
  });

  it("a turn nobody closed (the stream was cut) does not hold the person for ever", () => {
    expect(beginRun("u1", 0)).toBe(true);
    expect(beginRun("u1", RUN_TTL_MS - 1)).toBe(false);
    expect(beginRun("u1", RUN_TTL_MS + 1)).toBe(true);
  });

  it("a question asked while the first is still being answered is refused (429) and costs nothing; the turn is given back when the first ends, even when it fails", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow: Llm = { create: async () => (await gate, say("جاوبت")) };
    const first = ask("OWNER", slow, {}, "same");
    await vi.waitFor(() => expect(h.db.agentRun.rows.some((r) => r.agent === HOLD_AGENT)).toBe(true));

    const fast = scripted(say("x"));
    const second = ask("OWNER", fast, {}, "same");
    await expect(second).rejects.toMatchObject({ status: 429, code: "busy", message: BUSY });
    expect(fast.requests).toHaveLength(0);
    // somebody else may ask meanwhile
    await expect(ask("MANAGER", scripted(say("تمام")), {}, "someone-else")).resolves.toMatchObject({ answer: "تمام" });

    release();
    await expect(first).resolves.toMatchObject({ answer: "جاوبت" });
    // given back: the same person asks again
    await expect(ask("OWNER", scripted(say("تاني")), {}, "same")).resolves.toMatchObject({ answer: "تاني" });

    // a failing model gives the turn back too
    const broken: Llm = { create: async () => Promise.reject(Object.assign(new Error("boom"), { status: 500 })) };
    await expect(ask("OWNER", broken, {}, "same")).rejects.toBeInstanceOf(AssistantError);
    await expect(ask("OWNER", scripted(say("بعد الخطأ")), {}, "same")).resolves.toMatchObject({ answer: "بعد الخطأ" });
  });

  it("a refused question (a phone number in it) never takes the turn", async () => {
    const llm = scripted(say("x"));
    await expect(askAssistant({ question: "كلّم 0791234567", history: [], place: null }, caller("OWNER", "p"), { llm, now: NOW, products: async () => [] })).rejects.toThrow();
    expect(llm.requests).toHaveLength(0);
    expect(beginRun("p", NOW.getTime())).toBe(true);
  });
});

describe("the money of a call is held before the call", () => {
  const setCaps = async (daily: number, monthly = 0) => {
    await h.db.setting.create({ data: { key: "agents.daily_caps", value: { M12: daily } } });
    await h.db.setting.create({ data: { key: "agents.monthly_cap", value: monthly } });
  };
  /** The advisory lock the real database takes: the transactions of the cap's check go one after the other. */
  const serialised = () => {
    const real = h.db.$transaction.bind(h.db);
    let tail: Promise<unknown> = Promise.resolve();
    h.db.$transaction = ((fn: (tx: unknown) => Promise<unknown>) => {
      const run = tail.then(() => real(fn));
      tail = run.catch(() => undefined);
      return run;
    }) as typeof h.db.$transaction;
    return () => (h.db.$transaction = real as typeof h.db.$transaction);
  };

  it("a hold is the worst case of one call: a long conversation in and the longest answer out, never less than the dearest Claude", () => {
    expect(HOLD_INPUT_TOKENS).toBe(30_000);
    expect(holdUsd("claude-opus-5-5", null)).toBeCloseTo((30_000 * 4 + 8192 * 20) / 1_000_000, 6);
    expect(holdUsd("some-model-we-do-not-price", null)).toBeCloseTo(holdUsd("claude-opus-5-5", null), 6);
    expect(holdUsd("x", 0.002)).toBeCloseTo(((30_000 + 8192) / 1000) * 0.002, 6);
  });

  it("a second call sees the first one's hold: with room for one the second is refused with the cap's sentence", async () => {
    await setCaps(0.2);
    const a = await reserveBudget(NOW, 0.3, "claude-opus-5-5");
    expect(a).toHaveProperty("id");
    const b = await reserveBudget(NOW, 0.3, "claude-opus-5-5");
    expect(b).toMatchObject({ stop: expect.stringContaining("حد اليومي") });
    expect(h.db.agentRun.rows.filter((r) => r.agent === HOLD_AGENT)).toHaveLength(1);
  });

  it("people asking at the same moment: only as many calls go ahead as the cap has room for — the others are stopped before they are made", async () => {
    await setCaps(0.5);
    const unlock = serialised();
    try {
      const got = await Promise.all(Array.from({ length: 6 }, () => reserveBudget(NOW, 0.3, "claude-opus-5-5")));
      // the cap is a line the next call may cross (as it always was): 0 held → in; 0.3 held → in; 0.6 held → stopped
      expect(got.filter((g) => "id" in g)).toHaveLength(2);
      expect(got.filter((g) => "stop" in g)).toHaveLength(4);
    } finally {
      unlock();
    }
  });

  it("settling a hold frees it (the real cost is written by the log of the call); a hold nobody settled stops counting after ten minutes", async () => {
    await setCaps(0.5);
    const a = (await reserveBudget(NOW, 0.6, "m")) as { id: string };
    expect(await reserveBudget(NOW, 0.1, "m")).toHaveProperty("stop");
    await settleHold(a.id);
    expect(h.db.agentRun.rows).toHaveLength(0);
    expect(await reserveBudget(NOW, 0.1, "m")).toHaveProperty("id");
    // a process that went down after holding: the stale hold is swept by the next look
    h.db.agentRun.rows.length = 0;
    await reserveBudget(NOW, 0.9, "m");
    h.db.agentRun.rows[0]!.createdAt = new Date(NOW.getTime() - 11 * 60_000);
    expect(await reserveBudget(NOW, 0.1, "m")).toHaveProperty("id");
    expect(h.db.agentRun.rows.filter((r) => r.agent === HOLD_AGENT && Number(r.costUsd) === 0.9)).toHaveLength(0);
    await settleHold(null);
  });

  it("what was spent today counts with what is held; yesterday's does not; the monthly cap of every agent counts the holds too", async () => {
    await setCaps(1);
    await h.db.agentRun.create({ data: { agent: "M12", provider: "anthropic", model: "m", ok: true, costUsd: 1.2, createdAt: new Date("2026-11-22T06:00:00Z") } });
    expect(await reserveBudget(NOW, 0.1, "m")).toMatchObject({ stop: expect.stringContaining("حد اليومي") });
    h.db.agentRun.rows.length = 0;
    await h.db.agentRun.create({ data: { agent: "M12", provider: "anthropic", model: "m", ok: true, costUsd: 5, createdAt: new Date("2026-11-20T06:00:00Z") } });
    expect(await reserveBudget(NOW, 0.1, "m")).toHaveProperty("id");

    h.db.agentRun.rows.length = 0;
    h.db.setting.rows.length = 0;
    await setCaps(0, 2);
    await h.db.agentRun.create({ data: { agent: "M05", provider: "x", model: "m", ok: true, costUsd: 2.5, createdAt: new Date("2026-11-03T06:00:00Z") } });
    expect(await reserveBudget(NOW, 0.1, "m")).toMatchObject({ stop: expect.stringContaining("حد الشهري") });
  });

  it("a whole question: the hold is made before the model is called, gone when it answered, and the cost of the call is the only row left", async () => {
    await setCaps(3);
    let during = -1;
    const llm: Llm = { create: async () => ((during = h.db.agentRun.rows.filter((r) => r.agent === HOLD_AGENT).length), say("تمام")) };
    const r = await ask("OWNER", llm);
    expect(r.answer).toBe("تمام");
    expect(during).toBe(1);
    expect(h.db.agentRun.rows.filter((x) => x.agent === HOLD_AGENT)).toHaveLength(0);
    expect(h.db.agentRun.rows.filter((x) => x.agent === "M12")).toHaveLength(1);
    expect(h.db.agentRun.rows.find((x) => x.agent === "M12")).toMatchObject({ ok: true, tokensIn: 1000, tokensOut: 100 });
  });

  it("at the cap the loop answers with the cap's sentence and the model is never called", async () => {
    await setCaps(0.01);
    await h.db.agentRun.create({ data: { agent: "M12", provider: "anthropic", model: "m", ok: true, costUsd: 0.5, createdAt: NOW } });
    const llm = scripted(say("لا"));
    const r = await ask("OWNER", llm);
    expect(r.answer).toContain("حد اليومي");
    expect(llm.requests).toHaveLength(0);
    expect(h.db.agentRun.rows.filter((x) => x.agent === HOLD_AGENT)).toHaveLength(0);
  });
});
