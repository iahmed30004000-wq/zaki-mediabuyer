/**
 * THE SITE CARRIES OUT A JOB BY ITSELF (docs/rebuild-v6/01-model.md §5 · §9, v6 · P4-2). A job whose `wake` is `site_run` and that has a `recipe` is not handed to an agent: the clock (the watchdog)
 * or a press of «شغّلها من الموقع» calls `runRecipe`, which writes the run with the rope of three steps (read · compare · tell), writes the notices the recipe came to (once a day, by their key),
 * and ends the run — `ok`, or `failed` with the sentence of the step that could not go on (a number that is missing says so; it is never a zero).
 *
 * Nothing here touches Meta, spends or approves anything; what is read is the site's own numbers (the stock Claude pushed, the screens' loaders) and nothing about a customer. A run's notices go out
 * the way every notice does (`dispatchNotification`: the owner's switch, the urgency, the links).
 */
import { randomBytes } from "node:crypto";
import { isDemo } from "@/core/readiness";
import { RECIPE_STEP_IDS, isRecipeName, withTold, type RecipeOutcome, type RecipeName, type StepOutcome } from "@/core/recipes";
import { readRules } from "@/core/rules-v2";
import { GraphSchema, stepOrder } from "@/core/workflow";
import { audit, type Actor } from "../audit";
import { db } from "../db";
import { loadDirectory } from "../directory";
import { loadJob } from "../job-map";
import { createNotification, dispatchNotification } from "../notify";
import { getSetting } from "../settings";
import { UnknownJob, logRun } from "../workflows";
import { runDailySummary } from "./daily-summary";
import { runMetricWatch } from "./metric-watch";
import { runRemind } from "./remind";
import { runStockAlert } from "./stock-alert";
import { RecipeDataMissing, type RecipeDeps, type RecipeRunCtx } from "./types";

export type { RecipeDeps } from "./types";
export { RecipeDataMissing } from "./types";

export class RecipeRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const RUNNERS: Record<RecipeName, (ctx: RecipeRunCtx, deps: RecipeDeps) => Promise<RecipeOutcome>> = {
  stock_alert: runStockAlert,
  daily_summary: runDailySummary,
  remind: runRemind,
  metric_watch: runMetricWatch,
};

/** The real sources: the database and the screens' own loaders. */
export function realRecipeDeps(): RecipeDeps {
  return {
    products: async () => (await db.productEconomics.findMany({ select: { productCode: true, name: true }, orderBy: { productCode: "asc" } })).map((p) => ({ code: p.productCode, name: p.name })),
    stockReadings: async () => {
      const rows = await db.stockSnapshot.findMany({ orderBy: { at: "desc" }, take: 400 });
      const seen = new Set<string>();
      return rows.filter((r) => (seen.has(r.productCode) ? false : (seen.add(r.productCode), true))).map((r) => ({ code: r.productCode, units: r.units, daysCover: Number(r.daysCover), at: r.at }));
    },
    stockRules: async () => {
      const { redDays, orangeDays, yellowDays, audience } = readRules(await getSetting("campaign.rules")).stock;
      return { limits: { redDays, orangeDays, yellowDays }, audience };
    },
    numbers: async (period, now) => {
      // a demo site's numbers are made up: a notice built on them would be a lie
      if (isDemo(process.env)) throw new RecipeDataMissing("الموقع على البيانات التجريبية — الأرقام مش حقيقية");
      const { loadNumbers } = await import("@/lib/numbers-view");
      const n = await loadNumbers({ d: period }, now);
      return { label: n.label, totals: n.totals.current, prev: n.totals.prev, products: n.products.map((p) => ({ code: p.code, name: p.name, current: p.current })) };
    },
    person: async (key) => {
      const e = (await loadDirectory({ includeInactive: true })).find((x) => x.key === key);
      return e ? { key: e.key, name: e.name, active: e.active, kind: e.kind, hasTelegram: e.hasTelegram } : null;
    },
    dispatch: async (id) => void (await dispatchNotification(id)),
  };
}

export interface RecipeOpts {
  /** the slot's own reference (the clock asks) — else a reference of the site's own */
  ref?: string;
  scheduledFor?: Date;
  trigger?: "schedule" | "manual";
  now?: Date;
}

export interface RecipeRunResult {
  ref: string;
  runId: string;
  status: "ok" | "failed";
  steps: StepOutcome[];
  summary: string;
  /** how many notices were written new (the rest were already told today) */
  notified: number;
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

/** The one who writes a recipe's run is the site (the rope says «الموقع»), whoever pressed the button: the press is in the audit row. */
const SITE: Actor = { type: "system", id: "recipes" };

/**
 * Carries out one run of a recipe job. One at a time per job: the check for a run that is going and the first write of this one happen under one lock, so a press of the button and the clock
 * cannot both start. A source that cannot be read, or a number that is missing, ends the run `failed` with the reason on the step — the run is written either way, so the owner sees it.
 */
export async function runRecipe(key: string, actor: Actor, deps: RecipeDeps = realRecipeDeps(), opts: RecipeOpts = {}): Promise<RecipeRunResult> {
  const wf = await loadJob(key);
  if (!wf || wf.archivedAt) throw new UnknownJob((await db.workflow.findMany({ where: { archivedAt: null }, select: { key: true }, orderBy: { key: "asc" } })).map((w) => w.key));
  key = wf.key; // a key that was merged into another job leads to it
  if (!wf.enabled) throw new RecipeRefused("المهمة مطفية — شغّلها أول", 409);
  if (!isRecipeName(wf.recipe)) throw new RecipeRefused("هاي مش وصفة جاهزة — الموقع ما بينفّذ خطواتها لحاله");
  const name = wf.recipe;
  const graph = GraphSchema.parse(wf.graph);
  const stepIds = stepOrder(graph).filter((n) => n.type !== "trigger").map((n) => n.id);
  const ids = (i: number) => stepIds[i] ?? `s${i + 1}`;
  const triggers = graph.nodes.filter((n) => n.type === "trigger" && !n.disabled).map((n) => ({ id: n.id, status: "done" as const }));

  const now = opts.now ?? new Date();
  const ref = opts.ref ?? `site-${now.getTime().toString(36)}-${randomBytes(2).toString("hex")}`;
  let runId = "";
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exec:${wf.key}`}))`;
      const going = await tx.workflowRun.findFirst({ where: { workflowId: wf.id, status: "running", ref: { not: ref }, updatedAt: { gt: new Date(now.getTime() - wf.maxRunMin * 60_000) } } });
      if (going) throw new RecipeRefused("في تشغيل شغّال للمهمة هلق — استنى يخلص", 409);
      const started = await logRun(
        { job: wf.key, ref, status: "running", trigger: opts.trigger ?? "manual", started_at: now.toISOString(), ...(opts.scheduledFor ? { scheduled_for: opts.scheduledFor.toISOString() } : {}), summary: "عم يشتغل من الموقع", nodes: [...triggers, { id: ids(0), status: "running" as const }] },
        SITE,
        "ui",
        now,
        { site: true, actorKey: "site" },
      );
      runId = started.run.id;
    },
    { timeout: 20_000 },
  );

  const ctx: RecipeRunCtx = { jobKey: wf.key, jobName: wf.name, ref, now, runHref: `/tasks/${encodeURIComponent(wf.key)}/runs/${encodeURIComponent(runId)}`, params: wf.recipeParams };
  let outcome: RecipeOutcome;
  try {
    outcome = await RUNNERS[name](ctx, deps);
  } catch (e) {
    // a source that is down or a demo site: the step says so. Anything else is not told in detail (it could carry a address or a key): the log has it.
    if (!(e instanceof RecipeDataMissing)) console.error("[recipe]", wf.key, e);
    outcome = { ok: false, steps: [{ id: "s1", status: "failed", error: e instanceof RecipeDataMissing ? clip(e.message, 280) : "ما قدرت أقرا الأرقام — جرّب كمان مرة" }], summary: e instanceof RecipeDataMissing ? clip(e.message, 280) : "ما قدرت أقرا الأرقام", metrics: {}, notices: [], reason: e instanceof RecipeDataMissing ? e.message : "ما قدرت أقرا الأرقام" };
  }

  // the notices: once a day by their key; the new ones go out the way every notice does
  let created = 0;
  if (outcome.ok) {
    for (const n of outcome.notices) {
      try {
        const r = await createNotification({ urgency: n.urgency, audience: n.audience, title: n.title, body: n.body, href: n.href, source: "recipe", key: n.key });
        if (r.created) {
          created++;
          await deps.dispatch(r.id).catch(() => undefined);
        }
      } catch (e) {
        console.error("[recipe] notice failed", wf.key, e instanceof Error ? e.message : e);
      }
    }
    outcome = withTold(outcome, created);
  }

  const finished = opts.now ?? new Date();
  const nodes: { id: string; status: "done" | "failed" | "skipped"; note?: string; error?: string }[] = outcome.steps.map((s) => ({ id: ids(RECIPE_STEP_IDS.indexOf(s.id)), status: s.status, ...(s.note ? { note: clip(s.note, 200) } : {}), ...(s.error ? { error: clip(s.error, 280) } : {}) }));
  // the steps after the one that failed did not run: they are written as set aside (grey), so the rope stops at the failed one — left unwritten, the site would guess the next one failed too
  if (!outcome.ok) for (let i = outcome.steps.length; i < RECIPE_STEP_IDS.length; i++) nodes.push({ id: ids(i), status: "skipped", note: "ما اشتغلت — وقفت عند الخطوة اللي قبلها" });
  await logRun(
    {
      job: wf.key,
      ref,
      status: outcome.ok ? "ok" : "failed",
      finished_at: finished.toISOString(),
      summary: clip(outcome.summary, 300),
      ...(outcome.report ? { report: outcome.report } : {}),
      ...(Object.keys(outcome.metrics).length ? { metrics: outcome.metrics } : {}),
      nodes,
    },
    SITE,
    "ui",
    finished,
    { site: true, actorKey: "site", ...(outcome.ok ? {} : { endReason: "error" }) },
  );
  await audit(actor, "workflow.recipe", { type: "workflow", id: wf.key }, { after: { recipe: name, ref, ok: outcome.ok, notified: created } });
  // the end of the run — «فشلت» for the owner, «خلصت» for a job that asks for it — was told by `logRun` itself, once, by the run's own key
  return { ref, runId, status: outcome.ok ? "ok" : "failed", steps: outcome.steps, summary: outcome.summary, notified: created };
}
