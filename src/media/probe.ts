/**
 * ffprobe / ffmpeg on the worker (spec 13.3): read a video's facts, its MD5, and the six candidate thumbnail frames.
 * The binaries come from FFMPEG_PATH / FFPROBE_PATH or the PATH (the production image installs them).
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { Probe } from "@/core/creative";

const FFPROBE = () => process.env.FFPROBE_PATH || "ffprobe";
const FFMPEG = () => process.env.FFMPEG_PATH || "ffmpeg";

function run(bin: string, args: string[], timeoutMs = 120_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: String(e) });
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, out, err });
    });
  });
}

export function md5File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash("md5");
    createReadStream(file)
      .on("data", (c) => h.update(c))
      .on("end", () => resolve(h.digest("hex")))
      .on("error", reject);
  });
}

export async function probeVideo(file: string): Promise<Probe> {
  const r = await run(FFPROBE(), ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", file]);
  if (r.code !== 0) return { ok: false, durationS: 0, width: 0, height: 0, hasAudio: false, firstFrameBlack: false, error: r.err.slice(0, 200) };
  const j = JSON.parse(r.out) as { streams?: { codec_type?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: { rotation?: number }[] }[]; format?: { duration?: string } };
  const v = j.streams?.find((s) => s.codec_type === "video");
  if (!v) return { ok: false, durationS: 0, width: 0, height: 0, hasAudio: false, firstFrameBlack: false, error: "no video stream" };
  // a phone video recorded upright is often stored landscape with a 90° rotation tag
  const rot = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((s) => s.rotation !== undefined)?.rotation ?? 0)) % 180;
  const [width, height] = rot === 90 ? [v.height ?? 0, v.width ?? 0] : [v.width ?? 0, v.height ?? 0];
  const black = await run(FFMPEG(), ["-hide_banner", "-t", "0.5", "-i", file, "-vf", "blackdetect=d=0.1:pix_th=0.10", "-an", "-f", "null", "-"]);
  return {
    ok: true,
    durationS: Number(j.format?.duration ?? 0),
    width,
    height,
    hasAudio: Boolean(j.streams?.some((s) => s.codec_type === "audio")),
    firstFrameBlack: /black_start:0(\.0+)?\b/.test(black.err),
  };
}

/** One JPEG per moment (seconds) into `dir`; returns the written paths in order. */
export async function extractFrames(file: string, moments: number[], dir: string): Promise<string[]> {
  await mkdir(dir, { recursive: true });
  const out: string[] = [];
  for (const [i, t] of moments.entries()) {
    const target = path.join(dir, `frame-${i + 1}.jpg`);
    const r = await run(FFMPEG(), ["-hide_banner", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "3", target]);
    if (r.code === 0) out.push(target);
  }
  return out;
}
