/**
 * RUNNING A STEP FROM THE SITE ITSELF (v3 · F), the pure half. The site does not become a job engine (D26: Claude runs the work);
 * it may run a SHORT STRAIGHT LINE of steps whose doer is n8n, an HTTP address or Telegram, and only when every one of these holds:
 *
 *   • the step's permission is green (yellow / red / black wait for a person or Claude — they go to the handoff queue);
 *   • its target is on a list the owner wrote himself in the environment (n8n webhook names · https hosts) — nothing else is ever called;
 *   • what leaves the site carries no customer data and no key (the same privacy check as every other text that leaves).
 *
 * The first step the site may not run (a condition, a gate, a step for Claude or a person, an unlinked target) ends the walk:
 * it becomes a handoff with its words, and the run waits there. n8n gets the body signed (HMAC-SHA256 over «timestamp.body»).
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { refuseIfPrivate } from "./push-rows";
import { isSiteExecutor, stepOrder, type SiteExecutor, type WfGraph, type WfNode } from "./workflow";

export { SITE_EXECUTORS, isSiteExecutor, type SiteExecutor } from "./workflow";

export const MAX_BODY = 4_000;
export const MAX_TIMEOUT_S = 120;
export const DEFAULT_TIMEOUT_S = 30;
export const MAX_RETRIES = 3;

// ───────────────────────────── the owner's lists ─────────────────────────────

export interface SiteConfig {
  /** https://n8n.example.com (no path) — N8N_BASE_URL */
  n8nBase: string | null;
  /** the shared secret that signs what goes to n8n — N8N_WEBHOOK_SECRET */
  n8nSecret: string | null;
  /** webhook names the owner allows — N8N_ALLOWED_PATHS (comma separated) */
  n8nPaths: string[];
  /** https hosts the owner allows (`api.example.com`, or `*.example.com`) — STEP_HTTP_ALLOW */
  httpHosts: string[];
  /** a bot and an owner chat exist */
  telegram: boolean;
}

const list = (v: string | undefined) => (v ?? "").split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);

export function siteConfigFrom(env: Record<string, string | undefined>): SiteConfig {
  let base: string | null = null;
  try {
    const u = new URL(env.N8N_BASE_URL?.trim() ?? "");
    if (u.protocol === "https:" && !u.username && !u.password) base = u.origin;
  } catch {
    base = null;
  }
  return {
    n8nBase: base,
    n8nSecret: env.N8N_WEBHOOK_SECRET?.trim() || null,
    n8nPaths: list(env.N8N_ALLOWED_PATHS),
    httpHosts: list(env.STEP_HTTP_ALLOW),
    telegram: !!(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_OWNER_CHAT_ID?.trim()),
  };
}

// ───────────────────────────── addresses ─────────────────────────────

/** An address that is not the public internet: this machine, the private ranges, link-local, carrier-grade NAT, multicast, reserved. */
export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number) as [number, number];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase();
    const mapped = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]!);
    // the same address written in hex, which is how a URL parser prints it: ::ffff:7f00:1 is 127.0.0.1
    const hex = s.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) {
      const hi = parseInt(hex[1]!, 16);
      const lo = parseInt(hex[2]!, 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return s === "::" || s === "::1" || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || s.startsWith("ff");
  }
  return true; // not an address at all: not safe
}

export const hostAllowed = (host: string, allow: string[]) => allow.some((a) => (a.startsWith("*.") ? host.endsWith(a.slice(1)) && host.length > a.length - 1 : host === a));

export type Target = { ok: true; executor: SiteExecutor; url?: string; host?: string } | { ok: false; why: string };

/** Where a step would go, or why it may not go anywhere. */
export function resolveTarget(node: Pick<WfNode, "executor" | "target">, cfg: SiteConfig): Target {
  const ex = node.executor;
  if (!isSiteExecutor(ex)) return { ok: false, why: "منفّذها مش الموقع" };
  if (ex === "telegram") return cfg.telegram ? { ok: true, executor: ex } : { ok: false, why: "تيليجرام مش مربوط (TELEGRAM_BOT_TOKEN وTELEGRAM_OWNER_CHAT_ID)" };
  const t = (node.target ?? "").trim();
  if (!t) return { ok: false, why: ex === "n8n" ? "ما انكتب اسم الـ webhook بالخطوة (الهدف)" : "ما انكتب رابط الهدف بالخطوة" };
  if (ex === "n8n") {
    if (!cfg.n8nBase || !cfg.n8nSecret) return { ok: false, why: "n8n مش مربوط (N8N_BASE_URL بـ https وN8N_WEBHOOK_SECRET)" };
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(t)) return { ok: false, why: "اسم الـ webhook حروف وأرقام وشرطات بس" };
    if (!cfg.n8nPaths.includes(t.toLowerCase())) return { ok: false, why: `الـ webhook «${t}» مش بقائمتك المسموحة (N8N_ALLOWED_PATHS)` };
    return { ok: true, executor: ex, url: `${cfg.n8nBase}/webhook/${t}`, host: new URL(cfg.n8nBase).hostname };
  }
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    return { ok: false, why: "الرابط مش صحيح" };
  }
  if (u.protocol !== "https:") return { ok: false, why: "الرابط لازم https" };
  if (u.username || u.password) return { ok: false, why: "ممنوع اسم مستخدم أو كلمة سر بالرابط" };
  if (u.port && u.port !== "443") return { ok: false, why: "بس المنفذ العادي 443" };
  const host = u.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, "")) && isPrivateIp(host.replace(/^\[|\]$/g, ""))) return { ok: false, why: "عنوان داخلي ممنوع" };
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return { ok: false, why: "عنوان داخلي ممنوع" };
  if (!hostAllowed(host, cfg.httpHosts)) return { ok: false, why: `الموقع «${host}» مش بقائمتك المسموحة (STEP_HTTP_ALLOW)` };
  return { ok: true, executor: ex, url: u.href, host };
}

// ───────────────────────────── signing ─────────────────────────────

/** `sha256=<hex>` over «<timestamp>.<body>». */
export const signBody = (secret: string, timestamp: string, body: string): string => "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

/** What the receiving side (n8n) does: the same signature, a timestamp not older than `skewS`, compared in constant time. */
export function verifySignature(secret: string, timestamp: string, body: string, signature: string, nowMs: number, skewS = 300): boolean {
  const t = Number(timestamp);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > skewS) return false;
  const want = Buffer.from(signBody(secret, timestamp, body));
  const got = Buffer.from(signature);
  return want.length === got.length && timingSafeEqual(want, got);
}

// ───────────────────────────── what leaves ─────────────────────────────

export interface StepContext {
  workflow: string;
  runRef: string;
  node: Pick<WfNode, "id" | "label" | "prompt" | "inputs" | "timeoutS">;
}

/** The JSON body for n8n / HTTP: words only — or the reason it must not be sent. */
export function stepBody(c: StepContext, sentAt: string): { ok: true; body: string } | { ok: false; why: string } {
  const bad = refuseIfPrivate(c.node.label, c.node.prompt, c.node.inputs);
  if (bad) return { ok: false, why: bad };
  const body = JSON.stringify({ workflow: c.workflow, run_ref: c.runRef, node: { id: c.node.id, label: c.node.label }, text: c.node.prompt ?? "", inputs: c.node.inputs ?? "", sent_at: sentAt });
  return body.length > MAX_BODY ? { ok: false, why: `الحمولة ${body.length} حرف — الحد ${MAX_BODY}` } : { ok: true, body };
}

/** The Telegram text for a step, or why it must not be sent. */
export function stepMessage(workflowName: string, c: StepContext): { ok: true; text: string } | { ok: false; why: string } {
  const bad = refuseIfPrivate(workflowName, c.node.label, c.node.prompt);
  if (bad) return { ok: false, why: bad };
  const text = `${workflowName} — ${c.node.label}${c.node.prompt ? `\n${c.node.prompt}` : ""}`.slice(0, 1500);
  return { ok: true, text };
}

/** A reply as a short note on the step: the status, and a few words of the answer only if they pass the privacy check. */
export function replyNote(status: number, text: string): string {
  const head = `ردّ ${status}`;
  const body = text.replace(/\s+/g, " ").trim().slice(0, 120);
  return body && !refuseIfPrivate(body) ? `${head}: ${body}` : head;
}

// ───────────────────────────── the walk ─────────────────────────────

export interface PlanStep {
  node: WfNode;
  mode: "site" | "handoff";
  /** why it is a handoff */
  reason?: string;
  target?: Target;
}

/** The steps in running order, and for each: does the site run it or hand it over? (A trigger is not a step: it is done at the start.) */
export function planWorkflow(graph: WfGraph, cfg: SiteConfig): PlanStep[] {
  return stepOrder(graph)
    .filter((n) => n.type !== "trigger" && !n.disabled)
    .map((node): PlanStep => {
      if (node.type === "condition") return { node, mode: "handoff", reason: "شرط — الموقع ما بيحكم، بدها قرار" };
      if (node.type === "approval") return { node, mode: "handoff", reason: "بوّابة موافقة — بدها موافقتك" };
      if (node.type === "wait") return { node, mode: "handoff", reason: "انتظار — بدها حدا يكمّل بعده" };
      if (!isSiteExecutor(node.executor)) return { node, mode: "handoff", reason: "منفّذها Claude أو شخص" };
      if (node.permission !== "green") return { node, mode: "handoff", reason: "الصلاحية مش خضراء — الموقع بينفّذ الأخضر بس" };
      const target = resolveTarget(node, cfg);
      return target.ok ? { node, mode: "site", target } : { node, mode: "handoff", reason: target.why };
    });
}

/** The part of the plan the site runs: the steps before the first one it must hand over. */
export const siteRun = (plan: PlanStep[]): PlanStep[] => {
  const i = plan.findIndex((p) => p.mode === "handoff");
  return i === -1 ? plan : plan.slice(0, i);
};

/** Retry waits (ms) for a step with `retries` more tries: 1 s, 2 s, 4 s. */
export const retryDelays = (retries: number | undefined): number[] => Array.from({ length: Math.max(0, Math.min(MAX_RETRIES, retries ?? 0)) }, (_, i) => 1000 * 2 ** i);

export const timeoutMs = (n: Pick<WfNode, "timeoutS">): number => Math.min(MAX_TIMEOUT_S, Math.max(1, n.timeoutS ?? DEFAULT_TIMEOUT_S)) * 1000;

// ───────────────────────────── steps that ran out of time ─────────────────────────────

/** Steps marked «running» for longer than their own timeout (a step with no timeout is never overdue). */
export function overdueNodes(graph: WfGraph, states: Record<string, { status: string; at: string }>, nowMs: number): { node: WfNode; overBySec: number }[] {
  const out: { node: WfNode; overBySec: number }[] = [];
  for (const node of graph.nodes) {
    const s = states[node.id];
    if (!s || s.status !== "running" || !node.timeoutS || node.disabled) continue;
    const t = Date.parse(s.at);
    if (!Number.isFinite(t)) continue;
    const over = Math.floor((nowMs - t) / 1000) - node.timeoutS;
    if (over > 0) out.push({ node, overBySec: over });
  }
  return out;
}
