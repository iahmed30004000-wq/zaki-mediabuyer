/**
 * The v6 P1-1 migration is additive and safe on a live database, and the code that fills «who carries it out» agrees with what the migration fills.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXECUTORS, SEED_WORKFLOWS, assigneeOfExecutor } from "@/core/workflow";
import { jobRow } from "./helpers/fake-db";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb } = await import("./helpers/fake-db");
  h.db = makeFakeDb();
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { createWorkflow, ensureSeeded, updateWorkflow } from "@/server/workflows";

const dir = path.resolve(__dirname, "..", "prisma", "migrations");
const name = readdirSync(dir).find((d) => d.endsWith("_v6_engine"))!;
const sql = readFileSync(path.join(dir, name, "migration.sql"), "utf8");
const statements = sql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

describe("the migration is additive (rule 5 of docs/rebuild-v6/06-phases.md)", () => {
  it("runs after every migration that existed when it was written (P1-2's own migration, 20261124…, comes after it and is checked in tests/watchdog-migration-v6.test.ts)", () => {
    const all = readdirSync(dir).filter((d) => /^\d{14}_/.test(d)).sort();
    expect(all.indexOf(name)).toBeGreaterThan(all.indexOf("20261122100000_report_empty"));
  });

  it("has no DROP, RENAME, TRUNCATE, DELETE, type change or constraint that could refuse a live row", () => {
    for (const bad of [/\bDROP\b/i, /\bRENAME\b/i, /\bTRUNCATE\b/i, /\bDELETE\b/i, /\bALTER\s+COLUMN\b/i, /\bSET\s+NOT\s+NULL\b/i, /\bADD\s+CONSTRAINT\b/i, /\bADD\s+CHECK\b/i, /\bTYPE\b/i]) expect(sql, String(bad)).not.toMatch(bad);
  });

  it("only adds columns, one index, and touches rows with three statements it explains", () => {
    const kinds = statements.map((s) => s.split(/\s+/).slice(0, 2).join(" ").toUpperCase());
    expect(kinds.filter((k) => k === "ALTER TABLE")).toHaveLength(5);
    expect(kinds.filter((k) => k === "CREATE INDEX")).toHaveLength(1);
    expect(kinds.filter((k) => k === "INSERT INTO")).toHaveLength(1);
    expect(kinds.filter((k) => k === "UPDATE \"WORKFLOW\"" || k === "UPDATE \"HANDOFF\"")).toHaveLength(2);
    expect(statements).toHaveLength(9);
  });

  it("every column it adds is optional or has a default (an old row is valid without it)", () => {
    const adds = [...sql.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;\n]+)/g)].map((m) => ({ col: m[1]!, def: m[2]! }));
    expect(adds.length).toBeGreaterThanOrEqual(22);
    for (const a of adds) expect(/NOT NULL/.test(a.def) ? /DEFAULT/.test(a.def) : true, `${a.col}: ${a.def}`).toBe(true);
  });

  it("adds exactly the columns of docs/rebuild-v6/01-model.md §3", () => {
    const by = (table: string) => [...(sql.match(new RegExp(`ALTER TABLE "${table}"([\\s\\S]*?);`))?.[1] ?? "").matchAll(/ADD COLUMN\s+"(\w+)"/g)].map((m) => m[1]!).sort();
    expect(by("Workflow")).toEqual(["assigneeKey", "graceMin", "maxRunMin", "mergedInto", "notifyOn", "ownerEdited", "recipe", "recipeParams", "scheduleChangedAt", "wake"]);
    expect(by("WorkflowRun")).toEqual(["doneBy", "endReason", "graphVersion", "heartbeatAt", "scheduledFor"]);
    expect(by("Handoff")).toEqual(["claimNonce", "expiresAt", "leaseUntil", "scheduledFor"]);
    expect(by("Approval")).toEqual(["actedAt", "nodeId", "runRef"]);
    expect(by("Actor")).toEqual(["lastSeenAt"]);
  });

  it("the defaults are the plan's: wake self, 15 minutes of grace, 90 of silence, three events ring", () => {
    expect(sql).toContain(`"graceMin" INTEGER NOT NULL DEFAULT 15`);
    expect(sql).toContain(`"maxRunMin" INTEGER NOT NULL DEFAULT 90`);
    expect(sql).toContain(`"wake" TEXT NOT NULL DEFAULT 'self'`);
    expect(sql).toContain(`ARRAY['missed', 'stuck', 'failed']`);
  });

  it("adds the «site» actor without overwriting one that exists, and no person", () => {
    expect(sql).toMatch(/INSERT INTO "Actor"[\s\S]*'site'[\s\S]*ON CONFLICT \("key"\) DO NOTHING/);
    expect(sql.match(/\('actor_/g)).toHaveLength(1); // one row: the site
  });

  it("fills only the jobs that have no assignee yet", () => {
    expect(sql).toMatch(/WHERE w\."assigneeKey" IS NULL/);
  });
});

describe("who carries a job out, from its executor", () => {
  it("is the same table the migration writes", () => {
    for (const e of EXECUTORS) {
      const key = assigneeOfExecutor(e);
      if (e.startsWith("claude")) expect(key, e).toBe("claude");
      else if (e === "hermes" || e === "muse") expect(key, e).toBe(e);
      else if (["n8n", "http", "telegram", "system"].includes(e)) expect(key, e).toBe("site");
      else expect(key, e).toBeNull();
    }
    // the SQL lists the same executors
    for (const e of ["claude_mcp", "claude_task", "claude_desktop", "claude_api", "n8n", "http", "telegram", "system"]) expect(sql).toContain(`'${e}'`);
    expect(sql).toContain("WHEN w.\"executor\" = 'hermes' THEN 'hermes'");
    expect(sql).toContain("WHEN w.\"executor\" = 'muse' THEN 'muse'");
  });
});

describe("the code fills it too", () => {
  const owner = { type: "user" as const, id: "u1" };
  const wf = (key: string) => (h.db.workflow as unknown as { rows: Record<string, any>[] }).rows.find((r) => r.key === key)!;
  beforeEach(() => {
    for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  });

  it("a new database is seeded with each job's agent (Hermes's and Muse's jobs are theirs, the rest Claude's)", async () => {
    await ensureSeeded();
    expect(wf("daily-check").assigneeKey).toBe("claude");
    expect(wf("hermes-requests").assigneeKey).toBe("hermes");
    expect(wf("girls-training").assigneeKey).toBe("muse");
    for (const s of SEED_WORKFLOWS) expect(wf(s.key).assigneeKey, s.key).toBe(assigneeOfExecutor(s.executor));
  });

  it("a job made from a template or a copy is Claude's (its executor is)", async () => {
    const card = await createWorkflow({ name: "جديدة", template: "blank" }, owner);
    expect(wf(card.key).assigneeKey).toBe("claude");
  });

  it("changing the executor changes who carries it out — unless somebody chose that by hand", async () => {
    await h.db.workflow.create({ data: jobRow("a-job", ["x"], { executor: "claude_mcp", assigneeKey: "claude" }) });
    await updateWorkflow("a-job", { executor: "hermes" }, owner);
    expect(wf("a-job").assigneeKey).toBe("hermes");
    await h.db.workflow.create({ data: jobRow("by-hand", ["x"], { executor: "claude_mcp", assigneeKey: "muse" }) });
    await updateWorkflow("by-hand", { executor: "hermes" }, owner);
    expect(wf("by-hand").assigneeKey).toBe("muse");
    await h.db.workflow.create({ data: jobRow("empty", ["x"], { executor: "person", assigneeKey: null }) });
    await updateWorkflow("empty", { executor: "muse" }, owner);
    expect(wf("empty").assigneeKey).toBe("muse");
  });
});
