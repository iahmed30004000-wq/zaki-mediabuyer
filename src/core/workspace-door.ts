/**
 * THE WORKSPACE DOOR (v3 · W), pure. Zaki Workspace publishes a one-way «door» (its docs/contracts/workspace-door.v1.md): a
 * token may create a task in ONE board and read back the status of the tasks THAT token created — nothing else (it cannot edit
 * a task, nor read the team's own). So the sync is: push a person's task out, pull «open / done» back, and close it here when
 * the team finished it there. Nothing here reads a clock, a database or the network.
 */

/** People whose work lives in Workspace; the agents (Claude, Hermes, Muse) keep theirs here. */
export const HUMANS = ["abdullah", "hassan", "laith", "mohammad"] as const;

/** Most calls a run may make (the door allows 60 a minute per token, and the board listing is one more). */
export const PUSH_LIMIT = 20;
export const PULL_LIMIT = 30;

export interface DoorConfig {
  base: string;
  token: string;
  /** the board a pushed task lands in; empty = the only board the door lists */
  boardId: string | null;
}

/** Linked only with an https base (http only for a machine's own localhost) and a token. A base with a password in it is not a base. */
export function workspaceConfigFrom(env: Record<string, string | undefined>): DoorConfig | null {
  const raw = env.WORKSPACE_BASE_URL?.trim();
  const token = env.WORKSPACE_API_TOKEN?.trim();
  if (!raw || !token) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if ((u.protocol !== "https:" && !(local && u.protocol === "http:")) || u.username || u.password) return null;
  return { base: `${u.origin}${u.pathname.replace(/\/+$/, "")}`, token, boardId: env.WORKSPACE_BOARD_ID?.trim() || null };
}

export interface TaskLike {
  id: string;
  title: string;
  note: string | null;
  status: string;
  assignee: string | null;
  executor: string | null;
  dueAt: Date | null;
  priority: string;
  archivedAt: Date | null;
  wsId: string | null;
  wsError: string | null;
  wsSyncedAt: Date | null;
  updatedAt: Date;
}

/**
 * A person's open task that has not gone out yet. Agents' tasks, finished and archived ones stay here. A task the door refused
 * is not sent again until somebody edits it (a refusal says the words are wrong, and the same words are refused again).
 */
export function shouldPush(t: TaskLike): boolean {
  if (t.wsId || t.archivedAt || t.status === "done") return false;
  if (t.wsError && t.wsSyncedAt && t.updatedAt.getTime() <= t.wsSyncedAt.getTime()) return false;
  return (HUMANS as readonly string[]).includes(t.assignee ?? "") || t.executor === "person";
}

const PRIORITY: Record<string, string> = { urgent: "URGENT", high: "HIGH", normal: "NORMAL", low: "LOW" };

/** What the contract allows as an opaque reference: letters, digits and `. _ : - /`, at most 128, no spaces and no `@`. */
export const externalRefOf = (taskId: string) => `mb:task/${taskId}`;
/** Same key for every retry of the same task: the door then creates it once. */
export const idempotencyKeyOf = (taskId: string) => `mb-task-${taskId}`;

export interface DoorTaskBody {
  title: string;
  boardId: string;
  priority: string;
  externalRef: string;
  description?: string;
  dueDate?: string;
}

/**
 * The body of `POST /api/v1/tasks`. Only the fields the contract declares (it refuses any other), and only words: no assignee,
 * no customer, no price. The title is cut to the door's 280 and the note to its 10 000.
 */
export function toDoorTask(t: TaskLike, boardId: string): DoorTaskBody {
  const body: DoorTaskBody = { title: t.title.replace(/\u0000/g, "").slice(0, 280), boardId, priority: PRIORITY[t.priority] ?? "NORMAL", externalRef: externalRefOf(t.id) };
  if (t.note) body.description = t.note.replace(/\u0000/g, "").slice(0, 10_000);
  const due = t.dueAt?.toISOString().slice(0, 10);
  if (due && due >= "2000-01-01" && due <= "2100-12-31") body.dueDate = due;
  return body;
}

export interface DoorError {
  /** one line for the owner, in his words */
  why: string;
  /** worth trying again on the next run */
  retry: boolean;
  /** the whole door is shut (token, switch): stop this run instead of failing every task */
  stop: boolean;
}

/** An answer of the door that is not a success, as the owner reads it. The body is never echoed (it may carry an echo of a field). */
export function doorError(status: number, code?: string): DoorError {
  const c = code ?? "";
  if (status === 401) return { why: "الباب رفض المفتاح (انتهى أو انسحب) — سوّي مفتاح جديد بـ Workspace", retry: false, stop: true };
  if (status === 403) return { why: "المفتاح ما معه صلاحية «tasks.write» و«tasks.read»", retry: false, stop: true };
  if (status === 404 && c === "door.board_not_found") return { why: "اللوح مش لوح من مساحة المفتاح — غيّر WORKSPACE_BOARD_ID", retry: false, stop: true };
  if (status === 404) return { why: "باب الربط مقفول بـ Workspace (apiDoor) أو المهمة مش موجودة", retry: false, stop: false };
  if (status === 409) return { why: "نفس المفتاح انستعمل بمحتوى تاني", retry: false, stop: false };
  if (status === 422 && c === "door.customer_data_rejected") return { why: "الباب رفض اسم حقل (بيانات زبون)", retry: false, stop: false };
  if (status === 422) return { why: "الباب رفض المحتوى", retry: false, stop: false };
  if (status === 429) return { why: "تجاوزنا الحد (60 بالدقيقة) — بنكمل بالجولة الجاية", retry: true, stop: true };
  if (status >= 500) return { why: `Workspace ما ردّ منيح (${status})`, retry: true, stop: true };
  return { why: `ردّ غير متوقع (${status})`, retry: true, stop: false };
}

/** The board to send to: the owner's choice if the door lists it, else the only one. Anything else is a reason, not a guess. */
export function pickBoard(boards: { id: string; name?: string; project?: string }[], wanted: string | null): { ok: true; id: string } | { ok: false; why: string } {
  if (wanted) return boards.some((b) => b.id === wanted) ? { ok: true, id: wanted } : { ok: false, why: "اللوح المحدد مش من اللي بيعرضها الباب" };
  if (boards.length === 1) return { ok: true, id: boards[0]!.id };
  if (!boards.length) return { ok: false, why: "ما في لوح مفتوح لهالمفتاح بـ Workspace" };
  return { ok: false, why: `في ${boards.length} ألواح — حدّد واحد بـ WORKSPACE_BOARD_ID` };
}

/** The team finished it there: `done`, or a finish time. Only a close comes back — a reopened task is the owner's to move here. */
export function remoteDone(data: { status?: unknown; finishedAt?: unknown } | null | undefined): boolean {
  return data?.status === "done" || (typeof data?.finishedAt === "string" && data.finishedAt.length > 0);
}

/** Tasks to ask about: pushed, still open here, and not archived; the longest-unchecked first. */
export function pullQueue<T extends { wsId: string | null; status: string; archivedAt: Date | null; wsSyncedAt: Date | null }>(rows: T[], limit = PULL_LIMIT): T[] {
  return rows
    .filter((t) => t.wsId && t.status !== "done" && !t.archivedAt)
    .sort((a, b) => (a.wsSyncedAt?.getTime() ?? 0) - (b.wsSyncedAt?.getTime() ?? 0))
    .slice(0, limit);
}
