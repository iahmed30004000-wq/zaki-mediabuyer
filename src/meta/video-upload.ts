/**
 * VIDEO UPLOAD TO META (spec 7.4) — by the API only (the browser upload was slow and stuck, 16.6). The resumable
 * protocol of the official SDK (video-uploader.js): `start` with the size → `transfer` chunks until start == end →
 * `finish` with the title, then wait until `status.video_status` is no longer `processing`. The ad later uses the
 * returned `video_id` directly (no search by name, so V14 ↔ V140 cannot be mixed up).
 * Dry-run (META_WRITE_MODE ≠ live) uploads nothing and says so.
 */
import { openAsBlob } from "node:fs";
import { stat } from "node:fs/promises";
import type { WriteMode } from "./write";

export interface UploadOptions {
  token: string;
  version?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** wait for processing at most this long */
  timeoutMs?: number;
}

export interface UploadResult {
  videoId: string | null;
  status: "ready" | "processing" | "error" | "dry_run";
  attempts: number;
}

async function post(o: UploadOptions, url: string, body: FormData): Promise<Record<string, string>> {
  const res = await (o.fetch ?? fetch)(url, { method: "POST", headers: { authorization: `Bearer ${o.token}` }, body, signal: AbortSignal.timeout(300_000) });
  const j = (await res.json().catch(() => ({}))) as Record<string, string> & { error?: { message?: string } };
  if (!res.ok || j.error) throw new Error(`Meta advideos ${res.status}: ${(j.error?.message ?? "").replace(/access_token=[^&\s]+/g, "[redacted]")}`);
  return j;
}

export async function uploadVideo(o: UploadOptions, mode: WriteMode, accountId: string, file: string, title: string): Promise<UploadResult> {
  if (mode !== "live") return { videoId: null, status: "dry_run", attempts: 0 };
  const base = `https://graph.facebook.com/${o.version ?? process.env.META_API_VERSION ?? "v24.0"}`;
  const url = `${base}/${accountId}/advideos`;
  const size = (await stat(file)).size;
  const blob = await openAsBlob(file);
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const startForm = new FormData();
  startForm.set("upload_phase", "start");
  startForm.set("file_size", String(size));
  const start = await post(o, url, startForm);
  const session = start.upload_session_id!;
  const videoId = start.video_id!;
  let from = Number(start.start_offset);
  let to = Number(start.end_offset);
  let retries = Math.max(Math.ceil(size / (10 * 1024 * 1024)), 2);
  while (from !== to) {
    const form = new FormData();
    form.set("upload_phase", "transfer");
    form.set("upload_session_id", session);
    form.set("start_offset", String(from));
    form.set("video_file_chunk", blob.slice(from, to), "chunk");
    try {
      const r = await post(o, url, form);
      from = Number(r.start_offset);
      to = Number(r.end_offset);
    } catch (e) {
      if (retries-- <= 0) throw e;
      await sleep(2_000);
    }
  }
  const finish = new FormData();
  finish.set("upload_phase", "finish");
  finish.set("upload_session_id", session);
  finish.set("title", title);
  await post(o, url, finish);

  const deadline = Date.now() + (o.timeoutMs ?? 15 * 60_000);
  let attempts = 0;
  for (;;) {
    attempts++;
    const res = await (o.fetch ?? fetch)(`${base}/${videoId}?fields=status`, { headers: { authorization: `Bearer ${o.token}` } });
    const j = (await res.json().catch(() => ({}))) as { status?: { video_status?: string } };
    const s = j.status?.video_status ?? "processing";
    if (s === "ready") return { videoId, status: "ready", attempts };
    if (s === "error") return { videoId, status: "error", attempts };
    if (Date.now() > deadline) return { videoId, status: "processing", attempts };
    await sleep(10_000);
  }
}
