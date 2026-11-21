/**
 * BACKUP AND RESTORE (spec 17.4 «نسخة يومية واسترجاع تجريبي», T6.2). A logical copy of every table, written by the
 * app itself — no pg_dump needed on the image, and independent of the Postgres version — as one gzipped NDJSON file
 * per table plus a manifest with the counts and the last migration. Encrypted fields stay encrypted; no customer
 * identifier is ever stored in the first place (the OMS keeps them).
 *
 *   backup   → STORAGE_DIR/backups/YYYY-MM-DD/ (daily at 02:30, the last 14 kept)
 *   restore  → into an EMPTY database that already ran `prisma migrate deploy`; refuses a database with data in it
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createGunzip, createGzip } from "node:zlib";
import { createInterface } from "node:readline";
import { once } from "node:events";
import { Prisma, type PrismaClient } from "@prisma/client";

type Model = (typeof Prisma.dmmf.datamodel.models)[number];
type Delegate = { findMany: (a: unknown) => Promise<Record<string, unknown>[]>; createMany: (a: unknown) => Promise<{ count: number }>; count: () => Promise<number> };

const delegate = (db: PrismaClient, m: Model) => (db as unknown as Record<string, Delegate>)[m.name.charAt(0).toLowerCase() + m.name.slice(1)]!;

/** Tables in an order where every table comes after the ones it points to (so a restore never breaks a link). */
export function restoreOrder(models: readonly Model[]): Model[] {
  const out: Model[] = [];
  const done = new Set<string>();
  const deps = (m: Model) => m.fields.filter((f) => f.kind === "object" && (f.relationFromFields?.length ?? 0) > 0 && f.type !== m.name).map((f) => f.type);
  let left = [...models];
  while (left.length) {
    const ready = left.filter((m) => deps(m).every((d) => done.has(d)));
    if (!ready.length) throw new Error(`circular links between ${left.map((m) => m.name).join(", ")}`);
    for (const m of ready) {
      out.push(m);
      done.add(m.name);
    }
    left = left.filter((m) => !done.has(m.name));
  }
  return out;
}

export interface Manifest {
  at: string;
  migration: string | null;
  counts: Record<string, number>;
}

/**
 * The fields that make a row unique, in the order a backup reads them: the single `@id`, or the fields of a composite
 * `@@id`, or (no id at all) the first unique key. A table with none of them cannot be copied in a stable order, so it throws —
 * tests/backup-models.test.ts walks every model, which means a new kind of key breaks that test and never the nightly copy.
 */
export function keyFields(m: Model): string[] {
  const id = m.fields.find((f) => f.isId);
  if (id) return [id.name];
  if (m.primaryKey?.fields?.length) return [...m.primaryKey.fields];
  const unique = m.uniqueFields?.[0] ?? (m.fields.find((f) => f.isUnique) ? [m.fields.find((f) => f.isUnique)!.name] : undefined);
  if (unique?.length) return [...unique];
  throw new Error(`the table ${m.name} has no key to copy it in a stable order`);
}

const PAGE = 1000;
/** A copy takes one snapshot (RepeatableRead): the tables agree with each other even while the site writes. */
const SNAPSHOT_MS = 30 * 60_000;

async function copyTables(db: Pick<PrismaClient, "$queryRaw">, dir: string): Promise<Manifest> {
  const counts: Record<string, number> = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const d = delegate(db as PrismaClient, m);
    const keys = keyFields(m);
    const orderBy = keys.map((k) => ({ [k]: "asc" as const }));
    const gz = createGzip();
    const file = createWriteStream(path.join(dir, `${m.name}.ndjson.gz`));
    gz.pipe(file);
    let n = 0;
    let cursor: unknown;
    for (;;) {
      // one key: a cursor (cheap on a big table). A composite key: skip/take over the same order (those tables are small)
      const page = keys.length === 1 ? { ...(cursor !== undefined ? { cursor: { [keys[0]!]: cursor }, skip: 1 } : {}) } : { skip: n };
      const rows = await d.findMany({ take: PAGE, orderBy, ...page });
      for (const r of rows) if (!gz.write(`${JSON.stringify(r)}\n`)) await once(gz, "drain");
      n += rows.length;
      if (rows.length < PAGE) break;
      cursor = rows[rows.length - 1]![keys[0]!];
    }
    gz.end();
    await once(file, "finish");
    counts[m.name] = n;
  }
  const migration = await db.$queryRaw<{ migration_name: string }[]>`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT 1`.then((r) => r[0]?.migration_name ?? null).catch(() => null);
  const manifest: Manifest = { at: new Date().toISOString(), migration, counts };
  writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

export async function backupAll(db: PrismaClient, dir: string): Promise<Manifest> {
  mkdirSync(dir, { recursive: true });
  return db.$transaction((tx) => copyTables(tx, dir), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: SNAPSHOT_MS, maxWait: 30_000 });
}

/** Turn a JSON row back into what Prisma takes: dates as Date, nulls kept, relation fields dropped. */
function revive(m: Model, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of m.fields) {
    if (f.kind === "object" || !(f.name in row)) continue;
    const v = row[f.name];
    if (v === null) out[f.name] = f.type === "Json" ? Prisma.JsonNull : null;
    else if (f.type === "DateTime") out[f.name] = f.isList ? (v as string[]).map((x) => new Date(x)) : new Date(v as string);
    else out[f.name] = v;
  }
  return out;
}

/** Tables a migration fills with starter rows (20261117120000_team_actors): a freshly migrated database is "empty" with them in it, and the copy's rows replace them. */
const MIGRATION_SEEDED = new Set(["Actor"]);

export async function restoreAll(db: PrismaClient, dir: string, opts: { allowNonEmpty?: boolean } = {}): Promise<Record<string, number>> {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const models = restoreOrder(Prisma.dmmf.datamodel.models);
  if (!opts.allowNonEmpty) {
    for (const m of models) if (!MIGRATION_SEEDED.has(m.name) && (await delegate(db, m).count()) > 0) throw new Error(`the target database is not empty (${m.name}) — restore goes into an empty one`);
  }
  const restored: Record<string, number> = {};
  for (const m of models) {
    const file = path.join(dir, `${m.name}.ndjson.gz`);
    if (!existsSync(file)) {
      restored[m.name] = 0;
      continue;
    }
    const d = delegate(db, m);
    // the migration's own starter rows are replaced by the copy's (it holds the owner's edits of them)
    if (MIGRATION_SEEDED.has(m.name) && !opts.allowNonEmpty) await (db as unknown as Record<string, { deleteMany: () => Promise<unknown> }>)[m.name.charAt(0).toLowerCase() + m.name.slice(1)]!.deleteMany();
    let batch: Record<string, unknown>[] = [];
    let n = 0;
    const flush = async () => {
      if (!batch.length) return;
      n += (await d.createMany({ data: batch, skipDuplicates: true })).count;
      batch = [];
    };
    for await (const line of createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity })) {
      if (!line.trim()) continue;
      batch.push(revive(m, JSON.parse(line)));
      if (batch.length >= 500) await flush();
    }
    await flush();
    restored[m.name] = n;
  }
  for (const [name, count] of Object.entries(manifest.counts)) {
    if ((restored[name] ?? 0) !== count) throw new Error(`restore of ${name}: ${restored[name] ?? 0} rows, the backup has ${count}`);
  }
  return restored;
}

export function backupRoot(): string {
  return path.join(process.env.STORAGE_DIR?.trim() || path.join(process.cwd(), "storage"), "backups");
}

/** The daily job: today's folder, then keep the last `keep` days. The copy is written beside it and moved in only when complete, so a failed night never costs the last good folder of the same day. */
export async function dailyBackup(db: PrismaClient, now = new Date(), keep = 14) {
  const root = backupRoot();
  mkdirSync(root, { recursive: true });
  for (const left of readdirSync(root)) if (/^\.\d{4}-\d{2}-\d{2}\.partial$/.test(left)) rmSync(path.join(root, left), { recursive: true, force: true });
  const day = now.toISOString().slice(0, 10);
  const dir = path.join(root, day);
  const partial = path.join(root, `.${day}.partial`);
  let manifest: Manifest;
  try {
    manifest = await backupAll(db, partial);
  } catch (e) {
    rmSync(partial, { recursive: true, force: true });
    throw e;
  }
  rmSync(dir, { recursive: true, force: true });
  renameSync(partial, dir);
  const days = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - keep))) rmSync(path.join(root, old), { recursive: true, force: true });
  return { dir, tables: Object.keys(manifest.counts).length, rows: Object.values(manifest.counts).reduce((a, b) => a + b, 0), kept: Math.min(days.length, keep) };
}
