/**
 * A small in-memory stand-in for the part of the Prisma client the engine (workflows · handoffs · approvals · run actions) touches. It is not a database:
 * it keeps rows in arrays, understands the `where` shapes the code writes (equality, in, not, lt/lte/gt/gte, startsWith, OR, AND, a JSON path), the
 * compound keys (`workflowId_ref`, `workflowId_version`), `{ increment }`, and answers `$transaction` by running the function on itself.
 * The real database was used for the same flows by hand (see docs/rebuild-v6/NOTES.md); these tests keep the rules from moving.
 */
import { vi } from "vitest";

type Row = Record<string, any>;

const isDate = (v: unknown): v is Date => v instanceof Date;
const time = (v: unknown) => (isDate(v) ? v.getTime() : v);

function jsonAt(value: unknown, path: string[]): unknown {
  let cur: any = value;
  for (const p of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function cond(actual: unknown, want: unknown): boolean {
  if (want === null) return actual === null || actual === undefined;
  if (isDate(want)) return isDate(actual) && actual.getTime() === want.getTime();
  if (want && typeof want === "object" && !Array.isArray(want)) {
    const w = want as Row;
    if ("path" in w && "equals" in w) return jsonAt(actual, w.path as string[]) === w.equals;
    return Object.entries(w).every(([op, v]) => {
      switch (op) {
        case "in":
          return (v as unknown[]).some((x) => time(x) === time(actual));
        case "notIn":
          return !(v as unknown[]).some((x) => time(x) === time(actual));
        case "not":
          return !cond(actual, v);
        case "lt":
          return actual !== null && actual !== undefined && (time(actual) as number) < (time(v) as number);
        case "lte":
          return actual !== null && actual !== undefined && (time(actual) as number) <= (time(v) as number);
        case "gt":
          return actual !== null && actual !== undefined && (time(actual) as number) > (time(v) as number);
        case "gte":
          return actual !== null && actual !== undefined && (time(actual) as number) >= (time(v) as number);
        case "startsWith":
          return typeof actual === "string" && actual.startsWith(v as string);
        case "equals":
          return cond(actual, v);
        default:
          throw new Error(`fake-db: operator «${op}» is not supported`);
      }
    });
  }
  return time(actual) === time(want);
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") return (v as Row[]).some((w) => matches(row, w));
    if (k === "AND") return (Array.isArray(v) ? (v as Row[]) : [v as Row]).every((w) => matches(row, w));
    if (k === "NOT") return !matches(row, v as Row);
    return cond(row[k], v);
  });
}

/** `{ workflowId_ref: { workflowId, ref } }` → `{ workflowId, ref }` */
const flatten = (where: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(where)) {
    if (k.includes("_") && v && typeof v === "object" && !isDate(v) && !("in" in (v as Row)) && /^[a-zA-Z]+_[a-zA-Z]+$/.test(k) && !["path"].includes(k)) Object.assign(out, v);
    else out[k] = v;
  }
  return out;
};

export interface Table {
  rows: Row[];
  findUnique(a: { where: Row }): Promise<Row | null>;
  findUniqueOrThrow(a: { where: Row }): Promise<Row>;
  findFirst(a?: { where?: Row; orderBy?: Row | Row[] }): Promise<Row | null>;
  findMany(a?: { where?: Row; orderBy?: Row | Row[]; take?: number; select?: Row }): Promise<Row[]>;
  create(a: { data: Row }): Promise<Row>;
  createMany(a: { data: Row[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
  update(a: { where: Row; data: Row }): Promise<Row>;
  updateMany(a: { where?: Row; data: Row }): Promise<{ count: number }>;
  upsert(a: { where: Row; create: Row; update: Row }): Promise<Row>;
  count(a?: { where?: Row }): Promise<number>;
  aggregate(a: { where?: Row; _max?: Record<string, true>; _sum?: Record<string, true> }): Promise<{ _max: Record<string, unknown>; _sum: Record<string, number | null> }>;
  /** the one shape the code uses: `by` columns, `where`, and `_max` / `_count` */
  groupBy(a: { by: string[]; where?: Row; _max?: Record<string, true>; _count?: { _all: true } }): Promise<Row[]>;
  deleteMany(a?: { where?: Row }): Promise<{ count: number }>;
}

export function makeTable(defaults: () => Row, unique: string[][], clock: () => Date): Table {
  const rows: Row[] = [];
  let n = 0;
  const clone = (r: Row): Row => structuredClone(r);
  const sorted = (list: Row[], orderBy?: Row | Row[]) => {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).flatMap((o) => Object.entries(o));
    if (!keys.length) return list;
    return [...list].sort((a, b) => {
      for (const [k, dir] of keys) {
        const x = time(a[k]) as number;
        const y = time(b[k]) as number;
        if (x === y) continue;
        return ((x ?? 0) < (y ?? 0) ? -1 : 1) * (dir === "desc" ? -1 : 1);
      }
      return 0;
    });
  };
  const apply = (row: Row, data: Row) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === "object" && !isDate(v) && !Array.isArray(v) && "increment" in (v as Row)) row[k] = (row[k] ?? 0) + (v as Row).increment;
      else row[k] = v === undefined ? row[k] : v;
    }
    if ("updatedAt" in row) row.updatedAt = clock();
  };
  const t: Table = {
    rows,
    async findUnique({ where }) {
      const w = flatten(where);
      const r = rows.find((x) => matches(x, w));
      return r ? clone(r) : null;
    },
    async findUniqueOrThrow(a) {
      const r = await t.findUnique(a);
      if (!r) throw new Error("fake-db: not found");
      return r;
    },
    async findFirst(a = {}) {
      const r = sorted(rows.filter((x) => matches(x, a.where)), a.orderBy)[0];
      return r ? clone(r) : null;
    },
    async findMany(a = {}) {
      const list = sorted(rows.filter((x) => matches(x, a.where)), a.orderBy).slice(0, a.take ?? Infinity);
      return list.map(clone);
    },
    async create({ data }) {
      const row: Row = { id: `id${++n}`, createdAt: clock(), updatedAt: clock(), ...defaults(), ...structuredClone(data) };
      // like Postgres, a unique key with a null in it never collides
      for (const u of unique) if (u.every((k) => row[k] !== null && row[k] !== undefined) && rows.some((x) => u.every((k) => time(x[k]) === time(row[k])))) throw Object.assign(new Error(`fake-db: unique constraint on ${u.join("+")}`), { code: "P2002" });
      rows.push(row);
      return clone(row);
    },
    async createMany({ data, skipDuplicates }) {
      let c = 0;
      for (const d of data) {
        try {
          await t.create({ data: d });
          c++;
        } catch (e) {
          if (!skipDuplicates) throw e;
        }
      }
      return { count: c };
    },
    async update({ where, data }) {
      const w = flatten(where);
      const r = rows.find((x) => matches(x, w));
      if (!r) throw new Error("fake-db: update — not found");
      apply(r, data);
      return clone(r);
    },
    async updateMany({ where, data }) {
      const hit = rows.filter((x) => matches(x, where));
      for (const r of hit) apply(r, data);
      return { count: hit.length };
    },
    async upsert({ where, create, update }) {
      const w = flatten(where);
      const r = rows.find((x) => matches(x, w));
      if (r) {
        apply(r, update);
        return clone(r);
      }
      return t.create({ data: create });
    },
    async count(a = {}) {
      return rows.filter((x) => matches(x, a.where)).length;
    },
    async groupBy({ by, where, _max, _count }) {
      const groups = new Map<string, Row[]>();
      for (const r of rows.filter((x) => matches(x, where))) {
        const k = JSON.stringify(by.map((c) => time(r[c])));
        groups.set(k, [...(groups.get(k) ?? []), r]);
      }
      return [...groups.values()].map((g) => {
        const out: Row = Object.fromEntries(by.map((c) => [c, g[0]![c]]));
        if (_max) {
          out._max = {};
          for (const col of Object.keys(_max)) {
            const vals = g.map((r) => r[col]).filter((v) => v !== null && v !== undefined);
            out._max[col] = vals.length ? vals.reduce((a, b) => ((time(a) as number) >= (time(b) as number) ? a : b)) : null;
          }
        }
        if (_count) out._count = { _all: g.length };
        return out;
      });
    },
    async deleteMany({ where } = {}) {
      const hit = rows.filter((x) => matches(x, where));
      for (const r of hit) rows.splice(rows.indexOf(r), 1);
      return { count: hit.length };
    },
    async aggregate({ where, _max, _sum }) {
      const hit = rows.filter((x) => matches(x, where));
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(_max ?? {})) {
        const vals = hit.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
        out[k] = vals.length ? vals.reduce((a, b) => ((time(a) as number) >= (time(b) as number) ? a : b)) : null;
      }
      const sum: Record<string, number | null> = {};
      for (const k of Object.keys(_sum ?? {})) {
        const vals = hit.map((r) => r[k]).filter((v) => v !== null && v !== undefined);
        sum[k] = vals.length ? vals.reduce<number>((a, b) => a + Number(b), 0) : null;
      }
      return { _max: out, _sum: sum };
    },
  };
  return t;
}

/** The tables the engine touches. `clock` makes every write later than the last (a test never sees two writes at the same millisecond). */
export function makeFakeDb(start = new Date("2026-11-22T09:00:00Z")) {
  let tick = 0;
  const clock = () => new Date(start.getTime() + ++tick);
  const db = {
    workflow: makeTable(() => ({ description: null, schedule: null, executor: "claude_mcp", dataSource: "mcp", permission: "green", enabled: true, version: 1, archivedAt: null, number: null, domain: "ads", kind: "recurring", scheduleText: null, runsAt: null, endsAt: null, finishedAt: null, runsFrom: null, origin: null, touches: [], talksTo: [], note: null, advice: null, adviceText: null, decision: null, decidedAt: null, source: "seed", assigneeKey: null, wake: "self", graceMin: 15, maxRunMin: 90, notifyOn: ["missed", "stuck", "failed"], ownerEdited: [], mergedInto: null, scheduleChangedAt: null, recipe: null, recipeParams: null }), [["key"]], clock),
    workflowRun: makeTable(() => ({ trigger: "schedule", source: "mcp", finishedAt: null, summary: null, metrics: null, artifacts: null, nodeStates: {}, report: null, scheduledFor: null, doneBy: null, heartbeatAt: null, graphVersion: null, endReason: null }), [["workflowId", "ref"]], clock),
    workflowVersion: makeTable(() => ({ note: null, createdBy: null }), [["workflowId", "version"]], clock),
    handoff: makeTable(() => ({ runRef: null, nodeId: null, context: {}, assignee: "claude", status: "open", claimedBy: null, claimedAt: null, result: null, resultNote: null, doneBy: null, doneAt: null, createdBy: null, scheduledFor: null, expiresAt: null, leaseUntil: null, claimNonce: null }), [], clock),
    approval: makeTable(() => ({ ref: null, analysis: null, numbers: null, options: null, amount: null, urgency: "orange", status: "pending", source: "mcp", workflowKey: null, kind: null, expiresAt: null, postponedUntil: null, chosenOption: null, decisionNote: null, decidedBy: null, decidedAt: null, wakeOwner: false, notifiedAt: null, runRef: null, nodeId: null, actedAt: null }), [["ref"]], clock),
    standingOrder: makeTable(() => ({}), [], clock),
    task: makeTable(() => ({ assignee: null, status: "new", dueAt: null, archivedAt: null, priority: "normal" }), [], clock),
    notification: makeTable(() => ({ audience: "owner", body: null, href: null, source: "mcp", key: null, readAt: null, sentAt: null }), [["audience", "key"]], clock),
    agentRun: makeTable(() => ({ blocked: null, tokensIn: 0, tokensOut: 0, costUsd: 0, ms: 0, error: null }), [], clock),
    productEconomics: makeTable(() => ({ stockDays: null }), [["productCode"]], clock),
    stockSnapshot: makeTable(() => ({ units: null, source: "mcp" }), [], clock),
    setting: makeTable(() => ({ version: 1 }), [["key"]], clock),
    actor: makeTable(() => ({ lastSeenAt: null, active: true, telegram: null, kind: "agent" }), [["key"]], clock),
    apiToken: makeTable(() => ({ scopes: [], actorKey: null, revokedAt: null, expiresAt: null, lastUsedAt: null }), [["tokenHash"]], clock),
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
    $executeRaw: async () => 0,
    /** the watchdog's `pg_try_advisory_xact_lock`: this stand-in always gets the lock (a test sets `lock.held` to see it refused) */
    lock: { held: false },
    $queryRaw: async () => [{ ok: !db.lock.held }],
  };
  return db;
}

export type FakeDb = ReturnType<typeof makeFakeDb>;

/** A job (workflow row) with a plain chain of steps: a trigger, then the ids given. */
export function jobRow(key: string, steps: string[], extra: Row = {}): Row {
  const nodes = [{ id: "start", type: "trigger", label: "بداية" }, ...steps.map((id) => ({ id, type: "step", label: `خطوة ${id}`, executor: "claude_mcp" }))];
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i]!.id, to: n.id }));
  return { key, name: `مهمة ${key}`, graph: { nodes, edges }, assigneeKey: "claude", ...extra };
}

export const silenceAudit = () => ({ audit: vi.fn(async () => undefined) });
