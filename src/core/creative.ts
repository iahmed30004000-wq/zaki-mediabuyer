/**
 * THE CREATIVE INTAKE RULES (spec 7.2) — pure: what a video must be, how it is numbered and named.
 *
 *   valid · 9:16, 4:5 or 1:1 · the short side ≥ 720 px · has sound · the first frame is not black
 *   CR##### = the last number + 1, never reused (CreativeCounter)
 *   file name on Drive = name on Meta = name in the registry: {PRODUCT}_CR#####_{first 4 of MD5}.mp4
 */
export interface Probe {
  ok: boolean;
  durationS: number;
  width: number;
  height: number;
  hasAudio: boolean;
  /** share of the first half second that is black (0–1), from ffmpeg blackdetect */
  firstFrameBlack: boolean;
  error?: string;
}

export const ASPECTS = [
  { key: "9:16", ratio: 9 / 16 },
  { key: "4:5", ratio: 4 / 5 },
  { key: "1:1", ratio: 1 },
] as const;
export type Aspect = (typeof ASPECTS)[number]["key"];

/** The accepted aspect a frame size is closest to, within 3% — or null. */
export function aspectOf(width: number, height: number): Aspect | null {
  if (!width || !height) return null;
  const r = width / height;
  const hit = ASPECTS.find((a) => Math.abs(r - a.ratio) / a.ratio <= 0.03);
  return hit?.key ?? null;
}

export interface ProbeVerdict {
  ok: boolean;
  aspect: Aspect | null;
  /** the reasons, in the owner's words, when it is not ok */
  problems: string[];
}

export function judgeProbe(p: Probe): ProbeVerdict {
  const problems: string[] = [];
  if (!p.ok) return { ok: false, aspect: null, problems: [`الملف خربان أو مش فيديو${p.error ? ` (${p.error})` : ""}`] };
  const aspect = aspectOf(p.width, p.height);
  if (!aspect) problems.push(`المقاس ${p.width}×${p.height} مش 9:16 ولا 4:5 ولا 1:1`);
  if (Math.min(p.width, p.height) < 720) problems.push(`الدقة أقل من 720p (${p.width}×${p.height})`);
  if (!p.hasAudio) problems.push("ما فيه صوت");
  if (p.firstFrameBlack) problems.push("أول إطار أسود — الغلاف الحقيقي بالفيد");
  if (p.durationS < 3) problems.push("أقصر من 3 ثواني");
  return { ok: problems.length === 0, aspect, problems };
}

export const crCode = (n: number): string => `CR${String(n).padStart(5, "0")}`;

/** {PRODUCT}_CR#####_{md5[0:4]}.mp4 — the product part keeps letters and digits only (KamaaEye, TRF01). */
export function creativeFileName(product: string, code: string, md5: string, ext = "mp4"): string {
  const p = product.replace(/[^A-Za-z0-9]/g, "") || "PRODUCT";
  return `${p}_${code}_${md5.slice(0, 4).toLowerCase()}.${ext.replace(/^\./, "")}`;
}

/** Six candidate thumbnail moments inside the first 3 seconds (spec 7.5), never the very first black-risk frame. */
export function thumbnailMoments(durationS: number, count = 6): number[] {
  const end = Math.min(3, Math.max(0.6, durationS - 0.1));
  return Array.from({ length: count }, (_, i) => Math.round((0.25 + (i * (end - 0.25)) / (count - 1)) * 100) / 100);
}
