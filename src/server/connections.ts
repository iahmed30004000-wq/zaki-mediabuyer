/**
 * THE VALUES THE OWNER ENTERS FROM THE SITE (D62). Stored in `ConnectionSetting` (a secret sealed with SECRETS_MASTER_KEY, a plain value as it is), put over
 * `process.env` by a small in-process overlay so every adapter keeps reading the variable it always read — no call site changed. Resolution: the site's value, else
 * the environment's (Coolify keeps working untouched); delete the site's value and the environment comes back. The app applies a save at once; the worker, a
 * separate process, picks it up within `RELOAD_MS`. No value is ever returned to a browser or written to a log: the view carries «محفوظ ✓ · آخر 4».
 */
import { applyOverlay, checkValue, fieldOf, isBookkeeping, isSecretField, last4Of, newOverlay, ROWS, rowOf, sourceOf, type ConnField, type OverlayState } from "@/core/connections";
import { isLinked } from "@/core/readiness";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { db } from "./db";
import { MASTER_KEY_MISSING, masterKeyConfigured, openSecret, sealSecret } from "./secrets";

export const RELOAD_MS = 30_000;

type G = typeof globalThis & { __mbOverlay?: OverlayState; __mbOverlayTimer?: boolean };
const g = globalThis as G;
/** One overlay per process (a route bundle may load this module more than once; the state must not be forked). */
const state = (): OverlayState => (g.__mbOverlay ??= newOverlay());

/** The values to put over the environment: every stored name that has a readable value. A secret that cannot be opened (no key, wrong key) is skipped, not guessed. */
export async function storedValues(): Promise<Record<string, string>> {
  const rows = await db.connectionSetting.findMany();
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (isBookkeeping(r.name)) continue;
    const v = r.secret ? openSecret(r.name, r.valueEnc) : r.valuePlain;
    if (v) out[r.name] = v;
  }
  return out;
}

/** Make the process see what is stored. Never throws (a database that does not answer leaves the environment as it is). */
export async function reloadOverlay(): Promise<void> {
  try {
    applyOverlay(process.env, state(), await storedValues());
  } catch {
    // keep what we had
  }
}

/** Load now, then every RELOAD_MS. `refresh` is for the web process only: it also renews OAuth tokens (two processes must not race a rotating refresh token). */
export async function startOverlay(opts: { refresh: boolean }): Promise<void> {
  await reloadOverlay();
  if (opts.refresh) await import("./oauth-client").then((m) => m.refreshDueLinks()).catch(() => undefined);
  if (g.__mbOverlayTimer) return;
  g.__mbOverlayTimer = true;
  const t = setInterval(() => {
    void (async () => {
      if (opts.refresh) await import("./oauth-client").then((m) => m.refreshDueLinks()).catch(() => undefined);
      await reloadOverlay();
    })();
  }, RELOAD_MS);
  t.unref?.();
}

export interface FieldView {
  name: string;
  label: string;
  kind: ConnField["kind"];
  hint?: string;
  example?: string;
  source: "app" | "env" | "none";
  /** only for a value that is not a secret (an address, a folder id) */
  value?: string;
  last4?: string | null;
  updatedAt?: string;
  updatedBy?: string | null;
}

export interface LinkView {
  state: "none" | "linked" | "env" | "broken";
  at?: string;
  expiresAt?: string | null;
  scopes: string[];
}

export interface RowView {
  key: string;
  title: string;
  kind: "external" | "internal" | "info";
  note?: string;
  linked: boolean;
  testable: boolean;
  fields: FieldView[];
  link?: LinkView;
}

export interface ConnectionsView {
  masterKey: boolean;
  rows: RowView[];
}

/** Everything the page shows. A secret contributes only whether it exists, when it changed, who changed it and its last four characters. */
export async function connectionsView(): Promise<ConnectionsView> {
  const stored = await db.connectionSetting.findMany();
  const byName = new Map(stored.map((r) => [r.name, r]));
  const users = await db.user.findMany({ where: { id: { in: [...new Set(stored.map((r) => r.updatedBy).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const savedNames = new Set(stored.filter((r) => !isBookkeeping(r.name)).map((r) => r.name));
  const st = state();
  const rows: RowView[] = [];
  for (const row of ROWS) {
    const fields: FieldView[] = row.fields.map((f) => {
      const rec = byName.get(f.name);
      const source = sourceOf(f.name, savedNames, process.env, st);
      const secret = isSecretField(f);
      const view: FieldView = { name: f.name, label: f.label, kind: f.kind, hint: f.hint, example: f.example, source };
      if (!secret) {
        const v = source === "app" ? rec?.valuePlain : source === "env" ? st.originals.get(f.name) ?? process.env[f.name] : undefined;
        if (v) view.value = v;
      }
      if (source === "app" && rec) {
        view.last4 = rec.last4;
        view.updatedAt = rec.updatedAt.toISOString();
        view.updatedBy = rec.updatedBy ? nameOf.get(rec.updatedBy) ?? null : null;
      }
      return view;
    });
    let link: LinkView | undefined;
    if (row.link) {
      const token = byName.get(row.link.tokenName);
      const exp = byName.get(`${row.link.tokenName}__EXPIRES`)?.valuePlain;
      const bad = byName.get(`${row.link.tokenName}__STATE`)?.valuePlain === "broken";
      link = { state: bad ? "broken" : token && token.source === "oauth" ? "linked" : !token && sourceOf(row.link.tokenName, new Set(), process.env, st) === "env" ? "env" : "none", at: token?.updatedAt.toISOString(), expiresAt: exp ? new Date(Number(exp)).toISOString() : null, scopes: [...row.link.scopes] };
    }
    rows.push({ key: row.key, title: row.title, kind: row.kind, note: row.note, linked: row.kind === "info" ? false : safeLinked(row.key), testable: row.testable, fields, link });
  }
  return { masterKey: masterKeyConfigured(), rows };
}

function safeLinked(key: string): boolean {
  try {
    return isLinked(key);
  } catch {
    return false;
  }
}

/** Save one value from the site. A secret needs the master key; a value that fails its shape is refused with a sentence that never repeats it. */
export async function saveField(name: string, raw: unknown, userId: string): Promise<{ last4: string | null }> {
  const f = fieldOf(name);
  if (!f) throw new HttpError(400, "هالحقل مش من اللي بينحفظ من الموقع");
  const checked = checkValue(f, raw);
  if (!checked.ok) throw new HttpError(400, checked.error);
  const secret = isSecretField(f);
  if (secret && !masterKeyConfigured()) throw new HttpError(409, MASTER_KEY_MISSING);
  const last4 = last4Of(f, checked.value);
  const data = secret ? { secret: true, source: "app", valueEnc: sealSecret(name, checked.value), valuePlain: null, last4, updatedBy: userId } : { secret: false, source: "app", valueEnc: null, valuePlain: checked.value, last4: null, updatedBy: userId };
  await db.connectionSetting.upsert({ where: { name }, create: { name, ...data }, update: data });
  await reloadOverlay();
  // the name and the kind, never the value
  await audit({ type: "user", id: userId }, "connection.save", { type: "connection", id: name }, { after: { kind: f.kind, sealed: secret } });
  return { last4 };
}

/** «امسح»: the site's value goes, the environment's (if any) comes back. */
export async function clearField(name: string, userId: string): Promise<void> {
  const f = fieldOf(name);
  if (!f) throw new HttpError(400, "هالحقل مش من اللي بينحفظ من الموقع");
  await db.connectionSetting.deleteMany({ where: { name } });
  await reloadOverlay();
  await audit({ type: "user", id: userId }, "connection.delete", { type: "connection", id: name }, { after: { kind: f.kind } });
}

export { rowOf };
