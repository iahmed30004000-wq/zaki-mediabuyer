/**
 * The site carrying out its own recipes (v6 · P4-2, docs/rebuild-v6/01-model.md §5 · §9), on the in-memory stand-in of tests/helpers/fake-db.ts: a run is written with its three steps, a missing number
 * FAILS the step with its reason (the rope stops there), the notices are once a day by their key, the clock (the watchdog) and the buttons carry a recipe out without asking an agent, and «هلق» on a
 * new recipe job runs it at once. The real database was used for the same flows by hand (docs/rebuild-v6/NOTES.md).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { jobRow } from "./helpers/fake-db";

const state = vi.hoisted(() => ({ role: "OWNER" as string | null, audits: [] as { action: string; after?: unknown }[], db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> & { user: unknown } }));

vi.mock("next/headers", () => ({ cookies: () => ({ get: () => (state.role ? { value: "session" } : undefined) }) }));
vi.mock("@/lib/session-token", async (orig) => ({ ...(await orig<typeof import("@/lib/session-token")>()), authRequired: () => true, readSession: async (v?: string) => (v ? { sub: "u1", ver: 1 } : null) }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  const db = makeFakeDb() as ReturnType<typeof makeFakeDb> & { user: unknown };
  db.user = { findUnique: async () => (state.role ? { id: "u1", role: state.role, active: true, sessionVer: 1 } : null) };
  state.db = db;
  return { db };
});
vi.mock("@/server/audit", () => ({ audit: async (_a: unknown, action: string, _t: unknown, d?: { after?: unknown }) => void state.audits.push({ action, after: d?.after }) }));
vi.mock("@/server/env", () => ({ appOrigin: () => "https://x.test", omsLinked: () => false }));
vi.mock("@/adapters/telegram", () => ({ sendTelegram: async () => undefined, telegramFromEnv: () => null }));

import { WATCHDOG_SINCE_KEY } from "@/core/health";
import { recipeGraph, type JobDraft } from "@/core/job-draft";
import { RECIPES, type RecipeName } from "@/core/recipes";
import { SET_KEYS, type NumbersSet } from "@/core/numbers";
import { runWatchdog } from "@/jobs/watchdog";
import { POST as runNow } from "@/app/api/workflow/[key]/run/route";
import { POST as execute } from "@/app/api/workflow/[key]/execute/route";
import { POST as makeJob } from "@/app/api/jobs/route";
import { RecipeDataMissing, RecipeRefused, runRecipe, type RecipeDeps } from "@/server/recipes";
import { retryRun, skipRunStep } from "@/server/run-actions";
import { actionsFor } from "@/core/tasks-view";

type Rows = Record<string, any>[];
const rows = (name: string): Rows => (state.db as unknown as Record<string, { rows: Rows }>)[name]!.rows;
const NOW = new Date("2026-11-22T07:00:00.000Z"); // 10:00 on the Amman clock, a Sunday
const SLOT = "2026-11-22T07:00:00.000Z";
const set = (over: Partial<NumbersSet> = {}): NumbersSet => ({ ...(Object.fromEntries(SET_KEYS.map((k) => [k, null])) as NumbersSet), ...over });
const site = { type: "user" as const, id: "u1" };

/** A job of the site's own: the row `createJobFromDraft` would write for this recipe. */
async function addRecipeJob(key: string, recipe: RecipeName, params: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  const graph = recipeGraph({ name: recipe, params }, { triggerLabel: "كل يوم 10:00" });
  return state.db.workflow.create({ data: { ...jobRow(key, []), graph, recipe, recipeParams: params, wake: "site_run", assigneeKey: "site", executor: "system", schedule: "0 10 * * *", createdAt: new Date("2026-11-01T00:00:00Z"), ...extra } });
}

/** Stand-ins for what the recipes read; each test changes the parts it cares about. */
function deps(over: Partial<RecipeDeps> = {}): RecipeDeps & { sent: string[] } {
  const sent: string[] = [];
  return {
    sent,
    products: async () => [{ code: "TIN01", name: "الطنين" }, { code: "NEW01", name: "جديد" }],
    stockReadings: async () => [{ code: "TIN01", units: 40, daysCover: 4.2, at: new Date(NOW.getTime() - 3_600_000) }],
    stockRules: async () => ({ limits: { redDays: 7, orangeDays: 10, yellowDays: 14 }, audience: ["owner", "member1"] }),
    numbers: async () => ({ label: "أمس", totals: set({ spend: 120, ordersIn: 40, costPerOrder: 3, confirmed: 30 }), prev: set({ ordersIn: 32 }), products: [{ code: "TIN01", name: "الطنين", current: set({ spend: 120, ordersIn: 40, costPerOrder: 3 }) }] }),
    person: async (key) => (key === "member1" ? { key, name: "عضو الفريق", active: true, kind: "person", hasTelegram: false } : null),
    dispatch: async (id) => void sent.push(id),
    ...over,
  };
}

beforeEach(async () => {
  state.role = "OWNER";
  state.audits.length = 0;
  for (const t of Object.values(state.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  for (const [key, name, kind, team] of [["claude", "Claude", "agent", null], ["member1", "عضو الفريق", "person", "confirm"], ["site", "الموقع", "agent", null]] as const) await state.db.actor.create({ data: { key, name, kind, team } });
  await state.db.setting.create({ data: { key: WATCHDOG_SINCE_KEY, value: { at: "2026-11-01T00:00:00.000Z" } } });
});

describe("a stock alert, carried out by the site", () => {
  it("writes the run with its three steps (read · compare · tell), the notices to who the stock rules name, and the owner's phone is only rung for the new ones", async () => {
    await addRecipeJob("stock", "stock_alert", { product: "all" });
    const d = deps();
    const r = await runRecipe("stock", site, d, { now: NOW });
    expect(r).toMatchObject({ status: "ok", notified: 2 });
    const run = rows("workflowRun")[0]!;
    expect(run).toMatchObject({ status: "ok", doneBy: "site", trigger: "manual" });
    expect(run.summary).toContain("1 تحت الحد");
    const ids = Object.keys(run.nodeStates);
    expect(ids).toEqual(expect.arrayContaining(["s1", "s2", "s3"]));
    expect(run.nodeStates.s1).toMatchObject({ status: "done", note: "قريت مخزون 1 منتج · 1 بلا قراءة حديثة: جديد" });
    expect(run.nodeStates.s2).toMatchObject({ status: "done", note: "1 تحت الحد (أحمر 1 · برتقالي 0 · أصفر 0)" });
    expect(run.nodeStates.s3).toMatchObject({ status: "done", note: "بلّغت 2 إشعارات" });
    expect(rows("notification").map((n) => n.audience).sort()).toEqual(["member1", "owner"]);
    expect(rows("notification")[0]).toMatchObject({ urgency: "red", source: "recipe", href: "/ads?product=TIN01" });
    expect(d.sent).toHaveLength(2);
    // the run's own metrics are the code's numbers
    expect(run.metrics).toEqual({ products: 1, stock_red: 1, stock_orange: 0 });
    expect(state.audits.some((a) => a.action === "workflow.recipe")).toBe(true);
  });

  it("once a day: the same product at the same colour is not told twice, and the step says it was told before", async () => {
    await addRecipeJob("stock", "stock_alert", { product: "all" });
    const d = deps();
    await runRecipe("stock", site, d, { now: NOW });
    const again = await runRecipe("stock", site, d, { now: new Date(NOW.getTime() + 3 * 3_600_000) });
    expect(again.notified).toBe(0);
    expect(rows("notification")).toHaveLength(2);
    expect(d.sent).toHaveLength(2);
    const second = rows("workflowRun").find((x) => x.id === again.runId)!;
    expect(second.status).toBe("ok");
    expect(second.nodeStates.s3.note).toBe("2 إشعارات انبعتوا اليوم من قبل — ما انبعتوا تاني");
    // the next day it tells again
    const tomorrow = await runRecipe("stock", site, d, { now: new Date(NOW.getTime() + 24 * 3_600_000) });
    expect(tomorrow.notified).toBe(2);
  });

  it("a product with no stock recorded: the FIRST step fails with the reason, the rope stops there, nothing is told as «all fine», and the owner hears of the failure", async () => {
    await addRecipeJob("stock", "stock_alert", { product: "NEW01" });
    const r = await runRecipe("stock", site, deps(), { now: NOW });
    expect(r.status).toBe("failed");
    const run = rows("workflowRun")[0]!;
    expect(run).toMatchObject({ status: "failed", endReason: "error", doneBy: "site" });
    expect(run.summary).toBe("ما في مخزون مسجّل لـ جديد");
    expect(run.nodeStates.s1).toMatchObject({ status: "failed", error: "ما في مخزون مسجّل لـ جديد" });
    // the steps after it did not run: they are set aside (grey), never guessed «failed» too
    expect(run.nodeStates.s2).toMatchObject({ status: "skipped", note: "ما اشتغلت — وقفت عند الخطوة اللي قبلها" });
    expect(run.nodeStates.s3).toMatchObject({ status: "skipped" });
    expect(Object.values(run.nodeStates as Record<string, { status: string }>).filter((x) => x.status === "failed")).toHaveLength(1);
    const told = rows("notification");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ urgency: "orange", audience: "owner" });
    expect(told[0]!.key).toBe(`run.failed:${run.id}`);
    expect(told[0]!.title).toContain("فشلت");
  });
});

describe("a daily summary", () => {
  it("writes the report and the numbers on the run (for the results page) and one silent notice that opens the run", async () => {
    await addRecipeJob("sum", "daily_summary", { period: "yesterday" });
    const r = await runRecipe("sum", site, deps(), { now: NOW });
    expect(r.status).toBe("ok");
    const run = rows("workflowRun")[0]!;
    expect(run.report).toContain("ملخص أمس");
    expect(run.report).toContain("المجموع: صرف 120.00$");
    expect(run.metrics).toMatchObject({ spend: 120, orders: 40 });
    const n = rows("notification");
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ urgency: "yellow", audience: "owner", href: `/tasks/sum/runs/${run.id}`, key: "summary:sum:2026-11-22" });
  });

  it("a day with no number at all fails the step with the reason — it does not send an empty summary", async () => {
    await addRecipeJob("sum", "daily_summary", { period: "yesterday" });
    const r = await runRecipe("sum", site, deps({ numbers: async () => ({ label: "أمس", totals: set(), prev: set(), products: [] }) }), { now: NOW });
    expect(r.status).toBe("failed");
    expect(rows("workflowRun")[0]!.nodeStates.s1.error).toContain("ما في أرقام لـأمس");
    expect(rows("notification").every((n) => n.key.startsWith("run.failed:"))).toBe(true);
  });
});

describe("a number that crosses a limit", () => {
  it("a notice to the owner once a day; a number the site does not know fails the first step instead of reading as zero", async () => {
    await addRecipeJob("watch", "metric_watch", { metric: "realCost", product: "all", op: "above", limit: 2.5, period: "yesterday" });
    const first = await runRecipe("watch", site, deps(), { now: NOW });
    expect(first.notified).toBe(1);
    expect(rows("notification")[0]).toMatchObject({ audience: "owner", urgency: "orange" });
    expect((await runRecipe("watch", site, deps(), { now: new Date(NOW.getTime() + 3_600_000) })).notified).toBe(0);

    const unknown = await runRecipe("watch", site, deps({ numbers: async () => ({ label: "أمس", totals: set({ spend: 100 }), prev: set(), products: [] }) }), { now: new Date(NOW.getTime() + 2 * 3_600_000) });
    expect(unknown.status).toBe("failed");
    expect(unknown.summary).toContain("ناقص");
  });

  it("a named product the numbers do not have is «not known», not zero", async () => {
    await addRecipeJob("watch", "metric_watch", { metric: "orders", product: "NEW01", op: "below", limit: 5, period: "yesterday" });
    const r = await runRecipe("watch", site, deps(), { now: NOW });
    expect(r.status).toBe("failed");
    expect(rows("notification").some((n) => n.title.includes("تحت الحد"))).toBe(false);
  });
});

describe("a reminder to a person", () => {
  it("the notice is the person's and once per run", async () => {
    await addRecipeJob("rem", "remind", { person: "member1", text: "راجع الشحنات" });
    const r = await runRecipe("rem", site, deps(), { now: NOW, ref: `slot-${SLOT}`, scheduledFor: NOW, trigger: "schedule" });
    expect(r.status).toBe("ok");
    expect(rows("notification")).toHaveLength(1);
    expect(rows("notification")[0]).toMatchObject({ audience: "member1", urgency: "orange", key: `remind:rem:slot-${SLOT}` });
    expect(rows("workflowRun")[0]).toMatchObject({ ref: `slot-${SLOT}`, trigger: "schedule" });
    expect(rows("workflowRun")[0]!.scheduledFor.toISOString()).toBe(SLOT);
  });

  it("a person who left the directory: the first step fails", async () => {
    await addRecipeJob("rem", "remind", { person: "ghost", text: "راجع" });
    const r = await runRecipe("rem", site, deps(), { now: NOW });
    expect(r.status).toBe("failed");
    expect(rows("workflowRun")[0]!.nodeStates.s1.error).toBe("«ghost» مش بدليل الفريق");
  });
});

describe("a source that cannot be read", () => {
  it("says so on the step (its own words); anything else is told only as «ما قدرت أقرا الأرقام», never with the error text (it could hold an address or a key)", async () => {
    await addRecipeJob("sum", "daily_summary", { period: "yesterday" });
    const demo = await runRecipe("sum", site, deps({ numbers: async () => Promise.reject(new RecipeDataMissing("الموقع على البيانات التجريبية — الأرقام مش حقيقية")) }), { now: NOW });
    expect(demo.status).toBe("failed");
    expect(demo.summary).toBe("الموقع على البيانات التجريبية — الأرقام مش حقيقية");
    const boom = await runRecipe("sum", site, deps({ numbers: async () => Promise.reject(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2")) }), { now: new Date(NOW.getTime() + 60_000) });
    expect(boom.status).toBe("failed");
    expect(JSON.stringify(rows("workflowRun"))).not.toContain("hunter2");
    expect(JSON.stringify(rows("notification"))).not.toContain("hunter2");
    expect(boom.summary).toBe("ما قدرت أقرا الأرقام");
  });
});

describe("what a run may be", () => {
  it("only a job that is one of the site's recipes, switched on, one run at a time", async () => {
    await state.db.workflow.create({ data: jobRow("plain", ["a"]) });
    await expect(runRecipe("plain", site, deps(), { now: NOW })).rejects.toThrow(RecipeRefused);
    await addRecipeJob("off", "stock_alert", {}, { enabled: false });
    await expect(runRecipe("off", site, deps(), { now: NOW })).rejects.toMatchObject({ status: 409 });
    const wf = await addRecipeJob("busy", "stock_alert", {});
    await state.db.workflowRun.create({ data: { workflowId: wf.id, ref: "going", status: "running", startedAt: NOW, nodeStates: {} } });
    await expect(runRecipe("busy", site, deps(), { now: NOW })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("تشغيل شغّال") });
  });
});

describe("a recipe run that stopped", () => {
  it("«أعد المحاولة» runs the recipe again (there is no agent to resume it from a step) and the old run stays as it was; «تخطّى» is refused — its steps are fixed", async () => {
    await state.db.productEconomics.create({ data: { productCode: "NEW01", name: "جديد" } });
    await addRecipeJob("stock", "stock_alert", { product: "NEW01" });
    const first = await runRecipe("stock", site, deps(), { now: NOW });
    expect(first.status).toBe("failed");

    await expect(skipRunStep("stock", first.runId, site, NOW)).rejects.toMatchObject({ status: 409, message: expect.stringContaining("وصفة جاهزة") });

    // the stock arrives; the owner presses «أعد المحاولة»: a NEW run, not a request to an agent
    await state.db.stockSnapshot.create({ data: { productCode: "NEW01", units: 10, daysCover: 2, at: new Date(NOW.getTime() - 60_000) } });
    const again = await retryRun("stock", first.runId, site, new Date(NOW.getTime() + 60_000));
    expect(rows("handoff")).toHaveLength(0);
    expect(again.run.id).not.toBe(first.runId);
    expect(again.run.status).toBe("ok");
    expect(rows("workflowRun").find((r) => r.id === first.runId)!.status).toBe("failed");
    expect(rows("workflowRun")).toHaveLength(2);
  });

  it("the buttons of a stopped recipe run: «شغّلها كمان مرة», not the retry and skip of an agent's run", () => {
    expect(actionsFor("fail", { recipe: true }).map((a) => a.key)).toEqual(["run_now", "open"]);
    expect(actionsFor("lost", { recipe: true })[0]).toMatchObject({ key: "run_now", label: "شغّلها كمان مرة", variant: "primary" });
    expect(actionsFor("fail").map((a) => a.key)).toEqual(["retry", "skip", "open"]);
    expect(actionsFor("stuck").map((a) => a.key)).toEqual(["retry", "skip", "open"]);
  });
});

describe("the clock carries a recipe out by itself", () => {
  it("at the slot: the watchdog runs the recipe with the slot's own ref — no request is made to an agent — and a second pass does nothing", async () => {
    await state.db.productEconomics.create({ data: { productCode: "TIN01", name: "الطنين" } });
    await state.db.stockSnapshot.create({ data: { productCode: "TIN01", units: 40, daysCover: 4.2, at: new Date(NOW.getTime() - 3_600_000) } });
    await state.db.setting.create({ data: { key: "campaign.rules", value: { stock: { audience: ["owner"] } } } });
    await addRecipeJob("stock", "stock_alert", { product: "all" });

    const first = await runWatchdog(new Date(NOW.getTime() + 60_000));
    expect(first.planned).toEqual({ fire: 1 });
    expect(first.applied).toEqual({ fire: 1 });
    expect(rows("handoff")).toHaveLength(0);
    const run = rows("workflowRun")[0]!;
    expect(run).toMatchObject({ ref: `slot-${SLOT}`, status: "ok", trigger: "schedule", doneBy: "site" });
    expect(run.scheduledFor.toISOString()).toBe(SLOT);
    expect(rows("notification").filter((n) => n.source === "recipe")).toHaveLength(1);
    expect(state.audits.find((a) => a.action === "workflow.scheduled")?.after).toMatchObject({ how: "recipe", status: "ok" });

    const second = await runWatchdog(new Date(NOW.getTime() + 2 * 60_000));
    expect(second.applied).toEqual({});
    expect(rows("workflowRun")).toHaveLength(1);
  });

  it("with the stock not recorded, the slot is still answered: a FAILED run (with the reason), not «فاتت» and not a request nobody could take", async () => {
    await addRecipeJob("stock", "stock_alert", { product: "all" });
    await runWatchdog(new Date(NOW.getTime() + 60_000));
    const run = rows("workflowRun")[0]!;
    expect(run).toMatchObject({ ref: `slot-${SLOT}`, status: "failed" });
    expect(run.nodeStates.s1.error).toContain("ما في مخزون مسجّل");
    expect(rows("handoff")).toHaveLength(0);
    expect(rows("workflowRun").some((r) => r.status === "missed")).toBe(false);
  });
});

describe("«شغّلها هلق» on a recipe job", () => {
  const call = (key: string) => runNow(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ key }) });

  it("runs it right now (nobody in the queue could take it) and answers how it ended", async () => {
    await state.db.productEconomics.create({ data: { productCode: "NEW01", name: "جديد" } });
    await addRecipeJob("stock", "stock_alert", { product: "NEW01" });
    const r = await call("stock");
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body).toMatchObject({ ok: true, site: true, status: "failed" });
    expect(body.summary).toContain("ما في مخزون مسجّل");
    expect(rows("handoff")).toHaveLength(0);
    expect(rows("workflowRun")[0]).toMatchObject({ status: "failed", trigger: "manual" });
  });

  it("«شغّلها من الموقع» (the owner's call out of the site) carries a recipe out too — and not for the manager", async () => {
    await state.db.productEconomics.create({ data: { productCode: "NEW01", name: "جديد" } });
    await addRecipeJob("stock", "stock_alert", { product: "NEW01" });
    const exec = (key: string) => execute(new Request("http://localhost/x", { method: "POST" }), { params: Promise.resolve({ key }) });
    state.role = "MANAGER";
    expect((await exec("stock")).status).toBe(403);
    expect(rows("workflowRun")).toHaveLength(0);
    state.role = "OWNER";
    const r = await exec("stock");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, site: true, status: "failed" });
    expect(rows("workflowRun")).toHaveLength(1);
    expect(rows("handoff")).toHaveLength(0);
  });

  it("a job that is an agent's goes to the queue as before", async () => {
    await state.db.workflow.create({ data: jobRow("agentjob", ["a"]) });
    const r = await call("agentjob");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, created: true });
    expect(rows("handoff")).toHaveLength(1);
  });

  it("only who may control jobs", async () => {
    await addRecipeJob("stock", "stock_alert", {});
    state.role = "MEMBER";
    expect((await call("stock")).status).toBe(403);
    expect(rows("workflowRun")).toHaveLength(0);
  });
});

describe("saving a recipe job from «مهمة جديدة»", () => {
  const post = (d: JobDraft) => makeJob(new Request("http://localhost/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ draft: d }) }));
  const draft = (recipe: JobDraft["recipe"], over: Partial<JobDraft> = {}): JobDraft => ({ name: "تنبيه المخزون", domain: "ops", assigneeKey: "site", when: { kind: "daily", time: "09:30" }, steps: [], notifyOn: ["stuck", "missed", "failed"], recipe, ...over });

  beforeEach(async () => {
    await state.db.productEconomics.create({ data: { productCode: "TIN01", name: "الطنين" } });
  });

  it("each of the four becomes a job the site runs itself: wake site_run, the three steps drawn, the parameters kept, executor the site", async () => {
    const cases: [RecipeName, Record<string, unknown>][] = [
      ["stock_alert", { product: "TIN01" }],
      ["daily_summary", { period: "today" }],
      ["remind", { person: "member1", text: "راجع الشحنات" }],
      ["metric_watch", { metric: "spend", product: "all", op: "above", limit: 150, period: "yesterday" }],
    ];
    expect(cases.map((c) => c[0])).toEqual([...RECIPES]);
    for (const [name, params] of cases) {
      const r = await post(draft({ name, params }, { name: `وصفة ${name}` }));
      expect(r.status, name).toBe(201);
    }
    const jobs = rows("workflow").filter((w) => w.source === "ui");
    expect(jobs).toHaveLength(4);
    for (const j of jobs) {
      expect(j).toMatchObject({ wake: "site_run", assigneeKey: "site", executor: "system", dataSource: "api", kind: "recurring", schedule: "30 9 * * *" });
      expect(j.graph.nodes.map((n: { type: string }) => n.type)).toEqual(["trigger", "step", "step", "notify"]);
      expect(j.graph.nodes.filter((n: { type: string }) => n.type === "step").every((n: { dataSource: string; executor: string }) => n.dataSource === "api" && n.executor === "system")).toBe(true);
    }
    expect(jobs.find((j) => j.recipe === "stock_alert")).toMatchObject({ recipeParams: { product: "TIN01" } });
    expect(jobs.find((j) => j.recipe === "stock_alert")!.graph.nodes[1].label).toBe("اقرا: مخزون الطنين");
    expect(jobs.find((j) => j.recipe === "daily_summary")).toMatchObject({ recipeParams: { period: "today" } });
    expect(jobs.find((j) => j.recipe === "remind")!.graph.nodes[3].label).toBe("بلّغ: ذكّر عضو الفريق");
    expect(jobs.find((j) => j.recipe === "metric_watch")).toMatchObject({ recipeParams: { metric: "spend", product: "all", op: "above", limit: 150, period: "yesterday" } });
    // the numbers are the numbers the owner typed — none of the owner's rules came into a drawing
    expect(rows("workflowVersion")).toHaveLength(4);
  });

  it("«هلق» runs the recipe at once, with the slot's reference (the one-off finishes when it ends well) — and asks nobody", async () => {
    const r = await post(draft({ name: "remind", params: { person: "member1", text: "راجع" } }, { when: { kind: "now" }, name: "ذكّرني هلق" }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ kind: "job", asked: true });
    expect(rows("handoff")).toHaveLength(0);
    expect(rows("workflowRun")).toHaveLength(1);
    expect(rows("workflowRun")[0]!.ref).toMatch(/^slot-/);
  });

  it("what a recipe points at must exist: a product that is not the site's, an agent to remind, a person who is not there", async () => {
    const refused = async (recipe: JobDraft["recipe"], field: string) => {
      const r = await post(draft(recipe));
      expect(r.status).toBe(400);
      expect((await r.json()).field).toBe(field);
    };
    await refused({ name: "stock_alert", params: { product: "ZZZ99" } }, "recipe.product");
    await refused({ name: "remind", params: { person: "claude", text: "x" } }, "recipe.person");
    await refused({ name: "remind", params: { person: "ghost", text: "x" } }, "recipe.person");
    await refused({ name: "metric_watch", params: { metric: "spend", op: "above" } }, "recipe.limit");
    await refused({ name: "remind", params: { person: "member1", text: "اتصل على 0791234567" } }, "recipe");
    expect(rows("workflow").filter((w) => w.source === "ui")).toHaveLength(0);
  });

  it("the recipe with blocks of the owner's mixed in is refused, and the site with no recipe too", async () => {
    expect((await post(draft({ name: "stock_alert", params: {} }, { steps: [{ verb: "read", text: "اقرا" }] }))).status).toBe(400);
    expect((await post(draft(undefined))).status).toBe(400);
  });
});
