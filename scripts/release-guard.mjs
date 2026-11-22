#!/usr/bin/env node
/**
 * The two checks the release path leans on (v6 P0-3). No dependencies, so a workflow can run it straight from a checkout of `main`.
 *
 *   node scripts/release-guard.mjs protected-paths < list-of-changed-files   exit 1 when any file is one the owner must merge by hand
 *   node scripts/release-guard.mjs migrations [dir]                          exit 1 on a migration that is not additive
 *
 * 1. protected-paths: a pull request that changes how the site is built, checked or deployed is never merged by the robot;
 *    it waits for the owner's own click. The list is the deploy files plus this guard and its allow-list (a pull request must not be able
 *    to weaken the check that judges it and then merge itself).
 * 2. migrations: the database changes at start-up on the live data, so every migration must be additive and safe to run on a table that has rows:
 *    no DROP, no RENAME, no change of a column's type, no TRUNCATE, no DELETE without a WHERE, and no new NOT NULL column without a DEFAULT
 *    (it fails on a table that already has rows). A migration that must do one of these on purpose is listed by its folder name in
 *    `scripts/release-guard.allow` — that file is itself a protected path, so only the owner can let one through.
 *
 * Output names the rule and the place (`folder:line`), never the statement.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Files whose change needs the owner's own merge. Paths come from the pull request's file list (renames list both names). */
export const PROTECTED_PATHS = [/^\.github\//, /^Dockerfile$/, /^docker-compose[^/]*\.ya?ml$/, /^\.dockerignore$/, /^scripts\/release-guard[^/]*$/];

/** The changed files (from a list) that are protected. */
export function protectedChanges(files) {
  return files.map((f) => f.trim().replace(/\\/g, "/").replace(/^\.\//, "")).filter((f) => f && PROTECTED_PATHS.some((re) => re.test(f)));
}

/** SQL without comments (line `--` and block). Quoted names and strings are blanked before the keywords are looked for. */
export function stripSqlComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/--[^\n]*/g, "");
}

/** Split on commas that are not inside parentheses (`NUMERIC(10,2)`, `DEFAULT (a, b)`). */
function topLevelClauses(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth = Math.max(0, depth - 1);
    if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** The statements of a migration with the line each starts on (after comments are blanked, line numbers still match the file). */
function statementsOf(sql) {
  const clean = stripSqlComments(sql);
  const out = [];
  let start = 0;
  let line = 1;
  let startLine = 1;
  let first = true;
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === "\n") line++;
    if (clean[i] === ";") {
      out.push({ text: clean.slice(start, i), line: startLine });
      start = i + 1;
      first = true;
      continue;
    }
    if (first && /\S/.test(clean[i])) {
      startLine = line;
      first = false;
    }
  }
  if (/\S/.test(clean.slice(start))) out.push({ text: clean.slice(start), line: startLine });
  return out;
}

/**
 * What in one migration's SQL is not additive. Returns `[{ rule, line }]`.
 * `DROP NOT NULL` and `DROP DEFAULT` only loosen a column, so they pass; every other DROP does not (an index drop included: Prisma writes one
 * when an index changes, and the owner should see that).
 */
export function migrationProblems(sql) {
  const found = [];
  for (const { text, line } of statementsOf(sql)) {
    // identifiers and string values are blanked first: a column called "type" or a default of 'drop' is not a statement
    const t = text.replace(/"[^"]*"/g, '""').replace(/'(?:[^']|'')*'/g, "''").replace(/\s+/g, " ").trim();
    if (!t) continue;
    const drop = /\bDROP\b(?!\s+(NOT NULL|DEFAULT)\b)/i.test(t);
    if (drop) found.push({ rule: "drop", line });
    if (/\bRENAME\b/i.test(t)) found.push({ rule: "rename", line });
    if (/\bALTER\s+COLUMN\b.*\b(SET DATA TYPE|TYPE)\b/i.test(t)) found.push({ rule: "column-type", line });
    if (/^TRUNCATE\b/i.test(t)) found.push({ rule: "truncate", line });
    if (/^DELETE\s+FROM\b/i.test(t) && !/\bWHERE\b/i.test(t)) found.push({ rule: "delete-all", line });
    if (/^ALTER\s+TABLE\b/i.test(t)) {
      const body = t.replace(/^ALTER\s+TABLE\s+(ONLY\s+)?(IF EXISTS\s+)?("[^"]*"|\S+)\s*/i, "");
      for (const clause of topLevelClauses(body)) {
        const c = clause.trim();
        if (/^ADD\s+COLUMN\b/i.test(c) && /\bNOT NULL\b/i.test(c) && !/\bDEFAULT\b/i.test(c) && !/\b(SERIAL|BIGSERIAL|GENERATED)\b/i.test(c)) found.push({ rule: "not-null-without-default", line });
      }
    }
  }
  return found;
}

/** Folder names the owner let through on purpose (`scripts/release-guard.allow`: one name per line, `#` starts a comment). */
export function parseAllowList(text) {
  return new Set(
    text
      .split(/\r?\n/)
      .map((l) => l.replace(/#.*$/, "").trim())
      .filter(Boolean),
  );
}

/** Check every migration folder under `dir`. Returns `[{ migration, rule, line }]` for the ones not allowed. */
export function checkMigrations(dir, allow = new Set()) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const file = path.join(dir, name, "migration.sql");
    if (!existsSync(file) || allow.has(name)) continue;
    for (const p of migrationProblems(readFileSync(file, "utf8"))) out.push({ migration: name, ...p });
  }
  return out;
}

function main(argv) {
  const [cmd, arg] = argv;
  if (cmd === "protected-paths") {
    const list = readFileSync(0, "utf8").split(/\r?\n/);
    const hit = protectedChanges(list);
    for (const f of hit) console.log(f);
    return hit.length ? 1 : 0;
  }
  if (cmd === "migrations") {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = arg ?? path.join(here, "..", "prisma", "migrations");
    const allowFile = path.join(here, "release-guard.allow");
    const allow = existsSync(allowFile) ? parseAllowList(readFileSync(allowFile, "utf8")) : new Set();
    const bad = checkMigrations(dir, allow);
    for (const b of bad) console.error(`migration ${b.migration}:${b.line} is not additive (${b.rule})`);
    if (bad.length) console.error("A migration runs on the live data at start-up: keep it additive, or the owner lists it in scripts/release-guard.allow.");
    else console.log("migrations: all additive");
    return bad.length ? 1 : 0;
  }
  console.error("usage: release-guard.mjs protected-paths < files | migrations [dir]");
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
