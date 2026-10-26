/**
 * GOOGLE DRIVE (spec 7.1, 9.5) — a Service Account with Editor on the «المنتجات» folder. Per product:
 *   01_inbox   the owner and the team drop videos here, any name
 *   02_ready   after the checks and the naming
 *   excluded   duplicates and refusals — NOTHING IS EVER DELETED
 * Plain REST with a self-signed service-account JWT (jose), so no extra dependency. Renames and moves happen inside
 * Drive itself: the name on Drive = the name on Meta = the name in the registry.
 */
import { SignJWT, importPKCS8 } from "jose";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const API = "https://www.googleapis.com/drive/v3";
const SCOPE = "https://www.googleapis.com/auth/drive";
export const FOLDERS = { inbox: "01_inbox", ready: "02_ready", excluded: "excluded" } as const;

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface DriveOptions {
  account: ServiceAccount;
  fetch?: typeof fetch;
}

export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  md5Checksum?: string;
  parents?: string[];
}

export function driveFromEnv(): DriveOptions | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const account = JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8")) as ServiceAccount;
    return account.client_email && account.private_key ? { account } : null;
  } catch {
    return null;
  }
}

let cached: { token: string; until: number; email: string } | null = null;

async function token(o: DriveOptions): Promise<string> {
  if (cached && cached.email === o.account.client_email && cached.until > Date.now() + 60_000) return cached.token;
  const key = await importPKCS8(o.account.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE }).setProtectedHeader({ alg: "RS256" }).setIssuer(o.account.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const res = await (o.fetch ?? fetch)("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error(`Google token answered ${res.status}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, until: Date.now() + j.expires_in * 1000, email: o.account.client_email };
  return j.access_token;
}

async function call<T>(o: DriveOptions, pathAndQuery: string, init: RequestInit = {}): Promise<T> {
  const res = await (o.fetch ?? fetch)(`${API}${pathAndQuery}`, { ...init, headers: { authorization: `Bearer ${await token(o)}`, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`Drive ${pathAndQuery.split("?")[0]} answered ${res.status}`);
  return (await res.json()) as T;
}

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Children of a folder (files and folders), trash excluded. */
export async function listChildren(o: DriveOptions, folderId: string, onlyFolders = false): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  let pageToken: string | undefined;
  do {
    const query = `'${q(folderId)}' in parents and trashed = false${onlyFolders ? " and mimeType = 'application/vnd.google-apps.folder'" : ""}`;
    const params = new URLSearchParams({ q: query, fields: "nextPageToken, files(id, name, mimeType, size, md5Checksum, parents)", pageSize: "200", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
    if (pageToken) params.set("pageToken", pageToken);
    const page = await call<{ files: DriveItem[]; nextPageToken?: string }>(o, `/files?${params}`);
    out.push(...page.files);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/** The product folders and, inside each, its three working folders (created when missing — never deleted). */
export async function productFolders(o: DriveOptions, rootId: string) {
  const products = await listChildren(o, rootId, true);
  const result: { product: DriveItem; inbox: string; ready: string; excluded: string }[] = [];
  for (const product of products) {
    const sub = await listChildren(o, product.id, true);
    const ensure = async (name: string) => sub.find((f) => f.name === name)?.id ?? (await createFolder(o, name, product.id));
    result.push({ product, inbox: await ensure(FOLDERS.inbox), ready: await ensure(FOLDERS.ready), excluded: await ensure(FOLDERS.excluded) });
  }
  return result;
}

export async function createFolder(o: DriveOptions, name: string, parentId: string): Promise<string> {
  const f = await call<{ id: string }>(o, `/files?supportsAllDrives=true`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }) });
  return f.id;
}

export async function download(o: DriveOptions, fileId: string, target: string): Promise<void> {
  const res = await (o.fetch ?? fetch)(`${API}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { headers: { authorization: `Bearer ${await token(o)}` } });
  if (!res.ok || !res.body) throw new Error(`Drive download answered ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(target));
}

/** Rename and/or move in one call. Moving = add the new parent, remove the old one (the file itself stays). */
export async function renameMove(o: DriveOptions, fileId: string, p: { name?: string; from?: string; to?: string }): Promise<void> {
  const params = new URLSearchParams({ supportsAllDrives: "true" });
  if (p.to) params.set("addParents", p.to);
  if (p.from) params.set("removeParents", p.from);
  await call(o, `/files/${encodeURIComponent(fileId)}?${params}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(p.name ? { name: p.name } : {}) });
}
