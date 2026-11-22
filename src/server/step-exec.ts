/**
 * RUNNING STEPS FROM THE SITE (v3 · F), the server half. The owner presses «شغّلها من الموقع» on a workflow; the site walks its
 * straight line of green steps whose doer is n8n, an HTTP address or Telegram (src/core/step-exec.ts says which and why), logs
 * each step on the run as it goes, and at the first step it may not run — or one that fails — puts that step in the handoff
 * queue with its words and stops. Nothing here spends, approves or touches Meta; what leaves is words that passed the privacy
 * check, to addresses the owner listed himself.
 */
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { sendTelegram, telegramFromEnv } from "@/adapters/telegram";
import { isPrivateIp, overdueNodes, planWorkflow, replyNote, retryDelays, signBody, siteConfigFrom, siteRun, stepBody, stepMessage, timeoutMs, type PlanStep, type SiteConfig, type StepContext } from "@/core/step-exec";
import { GraphSchema, type NodeStates } from "@/core/workflow";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { createHandoff } from "./handoffs";
import { loadJob } from "./job-map";
import { UnknownJob, logRun } from "./workflows";

export class ExecRefused extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export interface ExecDeps {
  cfg: SiteConfig;
  fetch: typeof fetch;
  /** every address a host name points to */
  resolve: (host: string) => Promise<string[]>;
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  telegram: ((text: string) => Promise<void>) | null;
}

export function realDeps(): ExecDeps {
  const tg = telegramFromEnv();
  return {
    cfg: siteConfigFrom(process.env),
    fetch,
    resolve: async (host) => (await lookup(host, { all: true })).map((a) => a.address),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => new Date(),
    telegram: tg ? (text) => sendTelegram(tg, text) : null,
  };
}

type StepResult = { ok: true; note: string } | { ok: false; error: string; retryable: boolean };
const fail = (error: string, retryable = false): StepResult => ({ ok: false, error, retryable });

/** One try of one step. Never throws: a failure is a result. */
async function tryStep(step: PlanStep, ctx: StepContext, workflowName: string, d: ExecDeps): Promise<StepResult> {
  const target = step.target;
  if (!target?.ok) return fail(target?.why ?? "الهدف مش واضح");
  const now = d.now();
  if (target.executor === "telegram") {
    const m = stepMessage(workflowName, ctx);
    if (!m.ok) return fail(m.why);
    if (!d.telegram) return fail("تيليجرام مش مربوط");
    try {
      await d.telegram(m.text);
      return { ok: true, note: "انبعتت لتيليجرام" };
    } catch (e) {
      // the token is part of Telegram's address: say only that it failed, never what the error carries
      return fail(e instanceof Error && /answered (\d+)/.test(e.message) ? `تيليجرام ${e.message.match(/answered (\d+)/)![1]}` : "تيليجرام ما ردّ", true);
    }
  }
  const body = stepBody(ctx, now.toISOString());
  if (!body.ok) return fail(body.why);
  const url = new URL(target.url!);
  const headers: Record<string, string> = { "content-type": "application/json", "user-agent": "ZakiMediaBuyer/1", "x-mb-run-ref": ctx.runRef };
  if (target.executor === "n8n") {
    const ts = String(Math.floor(now.getTime() / 1000));
    headers["x-mb-timestamp"] = ts;
    headers["x-mb-signature"] = signBody(d.cfg.n8nSecret!, ts, body.body);
  } else {
    // an address the owner listed, but a name can point anywhere: every address it points to must be a public one
    let addrs: string[];
    try {
      addrs = await d.resolve(url.hostname);
    } catch {
      return fail("ما انحلّ اسم الموقع", true);
    }
    if (!addrs.length || addrs.some(isPrivateIp)) return fail("الاسم بيدلّ على عنوان داخلي — ممنوع");
  }
  try {
    const res = await d.fetch(url, { method: "POST", headers, body: body.body, redirect: "manual", signal: AbortSignal.timeout(timeoutMs(ctx.node)) });
    const text = (await res.text().catch(() => "")).slice(0, 2000);
    if (res.status >= 200 && res.status < 300) return { ok: true, note: replyNote(res.status, text) };
    if (res.status >= 300 && res.status < 400) return fail(`الرد تحويل (${res.status}) — ما بنتّبع التحويلات`);
    return fail(`ردّ ${res.status}`, res.status >= 500 || res.status === 429 || res.status === 408);
  } catch {
    return fail("ما ردّ بوقته أو انقطع الاتصال", true);
  }
}

async function runStep(step: PlanStep, ctx: StepContext, workflowName: string, d: ExecDeps): Promise<StepResult> {
  const waits = retryDelays(step.node.retries);
  let r = await tryStep(step, ctx, workflowName, d);
  for (const ms of waits) {
    if (r.ok || !r.retryable) break;
    await d.sleep(ms);
    r = await tryStep(step, ctx, workflowName, d);
  }
  return r;
}

export interface ExecResult {
  ref: string;
  status: "ok" | "waiting";
  ran: { id: string; label: string; status: "done" | "failed"; note: string }[];
  /** the step the run stopped at, and who has it now */
  handedOver?: { id: string; label: string; why: string };
}

const sec = (s: string, n: number) => s.slice(0, n);

/** What the clock adds when it is the one that asks: the slot's own ref, the slot it answers, and that it is not a manual run. */
export interface ExecOpts {
  ref?: string;
  scheduledFor?: Date;
  trigger?: "schedule" | "manual";
}

/**
 * Runs the steps the site may run for a job. One at a time per job (W-18): the check for a run that is going and the first write of this one happen
 * under one lock, so two presses of the button, or the button and the clock, cannot both start; a run that went quiet is the watchdog's to close
 * (a site run that lost its news is `failed`, and the owner's «أعد المحاولة» continues it).
 */
export async function executeWorkflow(key: string, actor: Actor, d: ExecDeps = realDeps(), opts: ExecOpts = {}): Promise<ExecResult> {
  const wf = await loadJob(key);
  if (!wf || wf.archivedAt) throw new UnknownJob((await db.workflow.findMany({ where: { archivedAt: null }, select: { key: true }, orderBy: { key: "asc" } })).map((w) => w.key));
  key = wf.key; // a key that was merged into another job leads to it
  if (!wf.enabled) throw new ExecRefused("هالورك فلو مطفي — شغّله أول", 409);
  if (wf.permission === "black") throw new ExecRefused("هالورك فلو أسود — ممنوع على الوكلاء وعلى الموقع", 403);
  const graph = GraphSchema.parse(wf.graph);
  const plan = planWorkflow(graph, d.cfg);
  const mine = siteRun(plan);
  if (!mine.length) throw new ExecRefused(`ما في خطوة بينفّذها الموقع هون${plan[0]?.reason ? ` — أول خطوة («${plan[0].node.label}»): ${plan[0].reason}` : ""}. استعمل «شغّل هلق» لتسلّمها لـ Claude.`);
  if (await db.handoff.findFirst({ where: { workflowKey: key, status: { in: ["open", "claimed"] } } })) throw new ExecRefused("في تسليم مفتوح للورك فلو — خلّصه أو الغِه أول", 409);

  const now = d.now();
  const ref = opts.ref ?? `site-${now.getTime().toString(36)}-${randomBytes(2).toString("hex")}`;
  const triggers = graph.nodes.filter((n) => n.type === "trigger" && !n.disabled).map((n) => ({ id: n.id, status: "done" as const }));
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`exec:${wf.key}`}))`;
      const going = await tx.workflowRun.findFirst({ where: { workflowId: wf.id, status: "running", ref: { not: ref }, updatedAt: { gt: new Date(now.getTime() - wf.maxRunMin * 60_000) } } });
      if (going) throw new ExecRefused("في تشغيل شغّال للمهمة هلق — استنى يخلص أو يوقف", 409);
      await logRun(
        { job: wf.key, ref, status: "running", trigger: opts.trigger ?? "manual", started_at: now.toISOString(), ...(opts.scheduledFor ? { scheduled_for: opts.scheduledFor.toISOString() } : {}), summary: "عم يشتغل من الموقع", ...(triggers.length ? { nodes: triggers } : {}) },
        actor,
        "ui",
        now,
      );
    },
    { timeout: 20_000 },
  );

  const ran: ExecResult["ran"] = [];
  const handoff = async (step: PlanStep, kind: "node_failed" | "needs_input", why: string, lastError?: string) => {
    await createHandoff(
      {
        workflow: key,
        kind,
        node: step.node.id,
        title: sec(`${step.node.label}: ${why}`, 160),
        need: sec(step.node.fallback ?? (kind === "node_failed" ? "الخطوة فشلت من الموقع — كمّلها أو أعد المحاولة" : why), 500),
        ...(lastError ? { last_error: sec(lastError, 500) } : {}),
        ...(step.node.prompt ? { prompt: sec(step.node.prompt, 2000) } : {}),
        run_ref: ref,
      },
      actor,
      d.now(),
    );
  };

  for (const step of mine) {
    await logRun({ job: key, ref, node: { id: step.node.id, status: "running" } }, actor, "ui", d.now());
    const r = await runStep(step, { workflow: key, runRef: ref, node: step.node }, wf.name, d);
    if (r.ok) {
      ran.push({ id: step.node.id, label: step.node.label, status: "done", note: r.note });
      await logRun({ job: key, ref, node: { id: step.node.id, status: "done", note: r.note } }, actor, "ui", d.now());
      continue;
    }
    ran.push({ id: step.node.id, label: step.node.label, status: "failed", note: r.error });
    await logRun({ job: key, ref, node: { id: step.node.id, status: "failed", note: sec(r.error, 200) } }, actor, "ui", d.now());
    await handoff(step, "node_failed", `فشلت من الموقع (${sec(r.error, 80)})`, r.error);
    await audit(actor, "workflow.execute", { type: "workflow", id: key }, { after: { ref, ran: ran.length, failedAt: step.node.id } });
    return { ref, status: "waiting", ran, handedOver: { id: step.node.id, label: step.node.label, why: r.error } };
  }

  const next = plan[mine.length];
  if (next) {
    const why = next.reason ?? "بدها حدا";
    await handoff(next, "needs_input", why);
    await audit(actor, "workflow.execute", { type: "workflow", id: key }, { after: { ref, ran: ran.length, handedTo: next.node.id } });
    return { ref, status: "waiting", ran, handedOver: { id: next.node.id, label: next.node.label, why } };
  }
  await logRun({ job: key, ref, status: "ok", finished_at: d.now().toISOString(), summary: sec(`خلصت من الموقع: ${ran.length} خطوة`, 300) }, actor, "ui", d.now());
  await audit(actor, "workflow.execute", { type: "workflow", id: key }, { after: { ref, ran: ran.length } });
  return { ref, status: "ok", ran };
}

/**
 * Steps that are «running» past their own timeout (any workflow, whoever runs it) go to the handoff queue as «انتهت المهلة», once each.
 * The run turns «waiting» through the handoff, so it is not swept twice.
 */
export async function sweepTimeouts(now = new Date()): Promise<{ checked: number; created: number }> {
  const runs = await db.workflowRun.findMany({ where: { status: "running" }, include: { workflow: true }, take: 200 });
  let created = 0;
  for (const run of runs) {
    const parsed = GraphSchema.safeParse(run.workflow.graph);
    if (!parsed.success || run.workflow.archivedAt) continue;
    for (const { node, overBySec } of overdueNodes(parsed.data, (run.nodeStates ?? {}) as unknown as NodeStates, now.getTime())) {
      const open = await db.handoff.findFirst({ where: { workflowKey: run.workflow.key, runRef: run.ref, nodeId: node.id, kind: "timeout", status: { in: ["open", "claimed"] } } });
      if (open) continue;
      await createHandoff(
        {
          workflow: run.workflow.key,
          kind: "timeout",
          node: node.id,
          title: sec(`انتهت مهلة «${node.label}»`, 160),
          need: sec(node.fallback ?? "الخطوة ما خلصت بوقتها — كمّلها أو أعد المحاولة", 500),
          last_error: `مهلتها ${node.timeoutS} ثانية وتعدّت بـ ${overBySec} ثانية`,
          ...(node.prompt ? { prompt: sec(node.prompt, 2000) } : {}),
          run_ref: run.ref,
        },
        { type: "system", id: "workflow.timeouts" },
        now,
      );
      created += 1;
    }
  }
  return { checked: runs.length, created };
}
