/**
 * Phase 3 acceptance (spec 14 T3.1/T3.3/T3.4), on the local database with REAL ffmpeg-made videos:
 *   a good video → numbered, named, ready, 6 thumbnails · its exact copy → duplicate (never deleted)
 *   a 540p video with no sound and a black start → waits for the owner, with the reasons
 *   a video whose ad text is the KamaaEye text → excluded, with the alternatives
 * `npx tsx --env-file=.env scripts/demo-creatives.ts`
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { db } from "../src/server/db";
import { processVideo } from "../src/jobs/creative-intake";

const dir = mkdtempSync(path.join(os.tmpdir(), "mb-demo-"));
const ff = (args: string[]) => spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args]);
const make = (name: string, args: string[]) => {
  const out = path.join(dir, name);
  ff([...args, out]);
  return out;
};
const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  const seed = String(Date.now() % 100000);
  const good = make("good.mp4", ["-f", "lavfi", "-i", `testsrc2=size=1080x1920:rate=25:duration=6`, "-f", "lavfi", "-i", `sine=frequency=${200 + (Number(seed) % 500)}:duration=6`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]);
  const copy = path.join(dir, "copy.mp4");
  copyFileSync(good, copy);
  const weak = make("weak.mp4", ["-f", "lavfi", "-i", `color=c=black:size=540x960:rate=25:duration=1`, "-f", "lavfi", "-i", `testsrc=size=540x960:rate=25:duration=4`, "-filter_complex", "[0:v][1:v]concat=n=2:v=1[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p"]);
  const kamaa = make("kamaa.mp4", ["-f", "lavfi", "-i", `testsrc2=size=1080x1350:rate=25:duration=5`, "-f", "lavfi", "-i", `sine=frequency=${900 + (Number(seed) % 300)}:duration=5`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac"]);

  const a = await processVideo(good, { productCode: "TRF01", source: "manual", originalName: "فيديو كمأة جديد.mp4", texts: { adText: "عبوة 30 مل، اطلب واستلم وادفع عند الباب" } });
  check(a.status === "ready" && "crCode" in a, `good video → ${a.status} ${"fileName" in a ? a.fileName : ""}`);
  const asset = "crCode" in a ? await db.creativeAsset.findUnique({ where: { crCode: a.crCode }, include: { thumbnails: true } }) : null;
  check(asset?.aspect === "9:16" && asset.thumbnails.length === 6, `   …9:16, ${asset?.thumbnails.length} candidate thumbnails`);
  check(!!asset?.fileName && /^TRF01_CR\d{5}_[0-9a-f]{4}\.mp4$/.test(asset.fileName), "   …named {PRODUCT}_CR#####_{md5}.mp4");

  const b = await processVideo(copy, { productCode: "TRF01", source: "manual", originalName: "نفس الفيديو (2).mp4" });
  check(b.status === "duplicate" && "dupOf" in b && b.dupOf === ("crCode" in a ? a.crCode : ""), `its copy → duplicate of ${"dupOf" in b ? b.dupOf : "?"}`);

  const c = await processVideo(weak, { productCode: "TIN01", source: "manual", originalName: "طنين قديم.mp4" });
  check(c.status === "review", `540p, no sound, black start → ${c.status}: ${"reason" in c ? c.reason : ""}`);

  const d = await processVideo(kamaa, { productCode: "TRF01", source: "manual", originalName: "kamaa-old.mp4", texts: { adText: "وماؤها شفاءٌ للعين. ليس كل ما يُباع في السوق هو الأصلي." } });
  check(d.status === "excluded", `the KamaaEye text → ${d.status}`);
  const n = "crCode" in a && "crCode" in c && "crCode" in d ? [a.crCode, c.crCode, d.crCode] : [];
  check(n.length === 3 && new Set(n).size === 3, `   …numbers never repeat: ${n.join(", ")}`);
  await db.$disconnect();
})();
