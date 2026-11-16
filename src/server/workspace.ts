/**
 * ZAKI WORKSPACE, the server half of the one-way door (v3 · W; the contract is Workspace's docs/contracts/workspace-door.v1.md).
 * Every few minutes: a person's open task that has not gone out is created there (once — the same Idempotency-Key on every retry),
 * and each task that went out is asked about, and closed here when the team finished it there. The door cannot edit or read the
 * team's own tasks, so nothing else comes back. The token never leaves this file; what leaves is words that passed the privacy
 * check, and the audit log records ids, never titles.
 */
import { refuseIfPrivate } from "@/core/push-rows";
import { PUSH_LIMIT, doorError, idempotencyKeyOf, pickBoard, pullQueue, remoteDone, shouldPush, toDoorTask, workspaceConfigFrom, type DoorConfig } from "@/core/workspace-door";
import { audit } from "./audit";
import { db } from "./db";

export interface DoorDeps {
  cfg: DoorConfig;
  fetch: typeof fetch;
}

export function realDoorDeps(env: Record<string, string | undefined> = process.env): DoorDeps | null {
  const cfg = workspaceConfigFrom(env);
  return cfg ? { cfg, fetch } : null;
}

export type SyncResult = {
  pushed: number;
  closed: number;
  checked: number;
  failed: number;
  /** why the run stopped early or did nothing */
  note?: string;
};

type Answer = { ok: true; status: number; data: Record<string, unknown> | null; list: unknown[] | null } | { ok: false; status: number; code?: string };

/** One call. Never throws, never logs or returns the token; an answer's body is read for `data` and `error.code` only. */
async function call(d: DoorDeps, method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<Answer> {
  let res: Response;
  try {
    res = await d.fetch(`${d.cfg.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${d.cfg.token}`, accept: "application/json", "user-agent": "ZakiMediaBuyer/1", ...(body !== undefined ? { "content-type": "application/json", "idempotency-key": idempotencyKey ?? "" } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { ok: false, status: 599 };
  }
  let json = null as { data?: unknown; error?: { code?: unknown } } | null;
  try {
    json = (await res.json()) as typeof json;
  } catch {
    json = null;
  }
  if (!res.ok) return { ok: false, status: res.status, code: typeof json?.error?.code === "string" ? json.error.code : undefined };
  const data = json?.data;
  return { ok: true, status: res.status, data: data && !Array.isArray(data) && typeof data === "object" ? (data as Record<string, unknown>) : null, list: Array.isArray(data) ? data : null };
}

export async function syncWorkspace(d: DoorDeps | null, now = new Date()): Promise<SyncResult> {
  const out: SyncResult = { pushed: 0, closed: 0, checked: 0, failed: 0 };
  if (!d) return { ...out, note: "Workspace مش مربوط (WORKSPACE_BASE_URL وWORKSPACE_API_TOKEN)" };
  const system = { type: "system", id: "workspace.sync" } as const;

  // ── out: a person's open task that has not gone yet ──
  const open = await db.task.findMany({ where: { wsId: null, archivedAt: null, status: { not: "done" } }, orderBy: { createdAt: "asc" }, take: 200 });
  const toPush = open.filter(shouldPush).slice(0, PUSH_LIMIT);
  if (toPush.length) {
    const boards = await call(d, "GET", "/api/v1/boards");
    if (!boards.ok) return { ...out, note: doorError(boards.status, boards.code).why };
    const board = pickBoard((boards.list ?? []) as { id: string }[], d.cfg.boardId);
    if (!board.ok) return { ...out, note: board.why };
    for (const t of toPush) {
      const refusal = refuseIfPrivate(t.title, t.note);
      if (refusal) {
        await db.task.update({ where: { id: t.id }, data: { wsError: "فيها بيانات زبون أو مفتاح — ما انبعتت", wsSyncedAt: now, updatedAt: t.updatedAt } });
        out.failed++;
        continue;
      }
      const r = await call(d, "POST", "/api/v1/tasks", toDoorTask(t, board.id), idempotencyKeyOf(t.id));
      if (r.ok && typeof r.data?.id === "string") {
        // being sent is not an edit: updatedAt stays as it was
        await db.task.update({ where: { id: t.id }, data: { wsId: r.data.id, wsSyncedAt: now, wsError: null, updatedAt: t.updatedAt } });
        await audit(system, "task.workspace.push", { type: "task", id: t.id }, { after: { remote: r.data.id } });
        out.pushed++;
        continue;
      }
      const e = r.ok ? { why: "ردّ غير مفهوم", retry: true, stop: false } : doorError(r.status, r.code);
      out.failed++;
      if (!e.retry && !e.stop) await db.task.update({ where: { id: t.id }, data: { wsError: e.why, wsSyncedAt: now, updatedAt: t.updatedAt } });
      if (e.stop) return { ...out, note: e.why };
    }
  }

  // ── back: what the team finished there ──
  const sent = await db.task.findMany({ where: { wsId: { not: null }, archivedAt: null, status: { not: "done" } }, take: 200 });
  for (const t of pullQueue(sent)) {
    const r = await call(d, "GET", `/api/v1/tasks/${encodeURIComponent(t.wsId!)}`);
    out.checked++;
    if (r.ok && remoteDone(r.data)) {
      await db.task.update({ where: { id: t.id }, data: { status: "done", wsSyncedAt: now, wsError: null } });
      await audit(system, "task.workspace.close", { type: "task", id: t.id }, { before: { status: t.status }, after: { status: "done", remote: t.wsId } });
      out.closed++;
      continue;
    }
    if (r.ok) {
      await db.task.update({ where: { id: t.id }, data: { wsSyncedAt: now, wsError: null, updatedAt: t.updatedAt } });
      continue;
    }
    const e = doorError(r.status, r.code);
    out.failed++;
    if (e.stop) return { ...out, note: e.why };
    await db.task.update({ where: { id: t.id }, data: { wsSyncedAt: now, wsError: r.status === 404 ? "المهمة مش موجودة بـ Workspace" : e.why, updatedAt: t.updatedAt } });
  }
  return out;
}
