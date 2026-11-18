/**
 * BACKUP AND RESTORE (spec 17.4 «نسخة يومية واسترجاع تجريبي», T6.2). A logical copy of every table, written by the
 * app itself — no pg_dump needed on the image, and independent of the Postgres version — as one gzipped NDJSON file
 * per table plus a manifest with the counts and the last migration. Encrypted fields stay encrypted; no customer
 * identifier is ever stored in the first place (the OMS keeps them).
 *
 *   backup   → STORAGE_DIR/backups/YYYY-MM-DD/ (daily at 02:30, the last 14 kept)
 *   restore  → into an EMPTY database that already ran `prisma migrate deploy`; refuses a database with data in it
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

export async function backupAll(db: PrismaClient, dir: string): Promise<Manifest> {
  mkdirSync(dir, { recursive: true });
  const counts: Record<string, number> = {};
  for (const m of Prisma.dmmf.datamodel.models) {
    const d = delegate(db, m);
    const id = m.fields.find((f) => f.isId)?.name ?? "id";
    const gz = createGzip();
    const file = createWriteStream(path.join(dir, `${m.name}.ndjson.gz`));
    gz.pipe(file);
    let n = 0;
    let cursor: unknown;
    for (;;) {
      const rows = await d.findMany({ take: 1000, orderBy: { [id]: "asc" }, ...(cursor !== undefined ? { cursor: { [id]: cursor }, skip: 1 } : {}) });
      for (const r of rows) if (!gz.write(`${JSON.stringify(r)}\n`)) await once(gz, "drain");
      n += rows.length;
      if (rows.length < 1000) break;
      cursor = rows[rows.length - 1]![id];
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

export async function restoreAll(db: PrismaClient, dir: string, opts: { allowNonEmpty?: boolean } = {}): Promise<Record<string, number>> {
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as Manifest;
  const models = restoreOrder(Prisma.dmmf.datamodel.models);
  if (!opts.allowNonEmpty) {
    for (const m of models) if ((await delegate(db, m).count()) > 0) throw new Error(`the target database is not empty (${m.name}) — restore goes into an empty one`);
  }
  const restored: Record<string, number> = {};
  for (const m of models) {
    const file = path.join(dir, `${m.name}.ndjson.gz`);
    if (!existsSync(file)) {
      restored[m.name] = 0;
      continue;
    }
    const d = delegate(db, m);
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

/** The daily job: today's folder, then keep the last `keep` days. */
export async function dailyBackup(db: PrismaClient, now = new Date(), keep = 14) {
  const root = backupRoot();
  const dir = path.join(root, now.toISOString().slice(0, 10));
  rmSync(dir, { recursive: true, force: true });
  const manifest = await backupAll(db, dir);
  const days = readdirSync(root).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - keep))) rmSync(path.join(root, old), { recursive: true, force: true });
  return { dir, tables: Object.keys(manifest.counts).length, rows: Object.values(manifest.counts).reduce((a, b) => a + b, 0), kept: Math.min(days.length, keep) };
}
