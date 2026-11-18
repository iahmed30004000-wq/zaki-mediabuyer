/**
 * The studio's launch requests (contract §4.2 #2–5, HANDOFF E1), on the local database, with a real video:
 *   the upload streams to disk and is checked (token · checksum · size), the same request twice is one request, another
 *   checksum is refused, the worker runs the normal intake, the status is derived, cancel works once — and a studio
 *   token can never approve anything. Nothing reaches Meta; no request launches by itself.
 * `npx tsx --env-file=.env scripts/demo-studio-launch.ts`   (never against the production database)
 */
import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { db } from "../src/server/db";
import { hashToken, newToken } from "../src/server/api-token";
import { processPendingRequests } from "../src/server/studio-launch";
import { middleware } from "../src/middleware";
import { POST as createRequest } from "../src/app/api/v1/vp/launch-requests/route";
import { GET as readRequest } from "../src/app/api/v1/vp/launch-requests/[id]/route";
import { POST as cancel } from "../src/app/api/v1/vp/launch-requests/[id]/cancel/route";
import { GET as productMarket } from "../src/app/api/vidpattern/product-market/route";
import { GET as productFacts } from "../src/app/api/v1/vp/products/[id]/facts/route";

const check = (ok: boolean, label: string) => {
  console.log(`${ok ? "✓" : "✗"} ${label}`);
  if (!ok) process.exitCode = 1;
};

const B = "----mbdemo" + randomUUID().replaceAll("-", "");
function multipart(video: Buffer | null, meta: unknown): Buffer {
  const parts: Buffer[] = [];
  if (video) parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="video"; filename="x.mp4"\r\nContent-Type: video/mp4\r\n\r\n`), video, Buffer.from("\r\n"));
  parts.push(Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="meta"\r\n\r\n${JSON.stringify(meta)}\r\n--${B}--\r\n`));
  return Buffer.concat(parts);
}

(async () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "mb-studio-demo-"));
  const storage = path.join(work, "storage");
  process.env.STORAGE_DIR = storage; // the demo's own storage: nothing is left in the real one
  const stamp = Date.now();
  const num = 9000 + (stamp % 999);
  const vpId = `VP-TRF01-${num}-v1`;
  const file = path.join(work, "video.mp4");
  const read = newToken();
  const launch = newToken();
  let tRead: { id: string } | null = null;
  let tLaunch: { id: string } | null = null;
  try {
    // a leftover from an earlier run never confuses this one
    await db.launchRequest.deleteMany({ where: { vpId: { startsWith: "VP-TRF01-9" } } });
    if (!(await db.productEconomics.findUnique({ where: { productCode: "TRF01" } }))) {
      await db.productEconomics.create({ data: { productCode: "TRF01", name: "كمأة", market: "SY", price: 24, unitCost: 6, deliveryFee: 2, returnFee: 1, codFeePct: 0.02, confirmCost: 0.8 } });
    }

    // 1. a real 6-second 1080×1920 video, different every run (the intake refuses a copy of a file it has seen)
    spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=25:duration=6", "-f", "lavfi", "-i", `sine=frequency=${300 + (stamp % 400)}:duration=6`, "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", file]);
    const video = readFileSync(file);
    const sha = createHash("sha256").update(video).digest("hex");
    check(video.length > 10_000, `1. a real video made: ${(video.length / 1024).toFixed(0)} KB, sha256 ${sha.slice(0, 12)}…`);

    tRead = await db.apiToken.create({ data: { name: "demo read", scopes: ["vp:read"], tokenHash: hashToken(read), prefix: read.slice(0, 10) } });
    tLaunch = await db.apiToken.create({ data: { name: "demo launch", scopes: ["vp:launch", "vp:read"], tokenHash: hashToken(launch), prefix: launch.slice(0, 10) } });
    const auth = (t: string) => ({ authorization: `Bearer ${t}` });
    const meta = { vp_id: vpId, product_id: "181", store_id: "1", country: "SY", mode: "test", framework: "PAS", pattern_id: "P01", hook_line: "جرّبت قبل؟", dialect: "شامي", duration_sec: 47, character_id: null, script_text: "تعرفوا الكمأة؟ طبيعية وبتوصلكم للباب والدفع عند الاستلام.", captions_srt: "1\n00:00:00,000 --> 00:00:03,000\nتعرفوا الكمأة؟", checksum_sha256: sha };
    const post = (token: string | null, body: Buffer, extra: Record<string, string> = {}) =>
      createRequest(new Request("http://x/api/v1/vp/launch-requests", { method: "POST", headers: { ...(token ? auth(token) : {}), "content-type": `multipart/form-data; boundary=${B}`, ...extra }, body: new Uint8Array(body) }));
    const json = async (r: Response) => (await r.json()) as Record<string, unknown>;

    // 2. no token → 401; a read token → 403 (the answer never needs the body read)
    const noTok = await post(null, multipart(video, meta));
    check(noTok.status === 401 && (await json(noTok)).code === "unauthorized", "2. no token → 401 unauthorized");
    const rd = await post(read, multipart(video, meta));
    check(rd.status === 403 && (await json(rd)).code === "forbidden", "   …a vp:read token → 403 forbidden");

    // the size limit is judged on Content-Length before a byte is read
    const huge = await post(launch, multipart(video, meta), { "content-length": String(700 * 1024 * 1024) });
    check(huge.status === 422 && (await json(huge)).code === "video_too_large", "   …a 700 MB upload is refused up front (422 video_too_large)");

    // 3. wrong checksum → 422 checksum_mismatch, and no file stays on disk
    const bad = await post(launch, multipart(video, { ...meta, checksum_sha256: "0".repeat(64) }));
    check(bad.status === 422 && (await json(bad)).code === "checksum_mismatch", "3. wrong checksum → 422 checksum_mismatch");
    const noMeta = await post(launch, multipart(video, { vp_id: vpId }));
    check(noMeta.status === 422 && (await json(noMeta)).code === "invalid_meta", "   …a meta with missing parts → 422 invalid_meta");
    const unknown = await post(launch, multipart(video, { ...meta, vp_id: "VP-nosuchproduct-1-v1" }));
    check(unknown.status === 422 && (await json(unknown)).code === "invalid_meta", "   …a product we do not know → 422 invalid_meta");
    check(!existsSync(path.join(storage, "incoming")) || !readdirSync(path.join(storage, "incoming")).length, "   …and none of those left a file behind");

    // 4. valid → 200 received
    const ok = await post(launch, multipart(video, meta));
    const okBody = await json(ok);
    check(ok.status === 200 && okBody.status === "received" && typeof okBody.request_id === "string" && okBody.reason === null && typeof okBody.ops_url === "string", `4. valid upload → 200 received (${okBody.request_id})`);
    const id = String(okBody.request_id);

    // 5. the same again → the same request; another checksum for the same script → 409
    const again = await json(await post(launch, multipart(video, meta)));
    check(again.request_id === id, "5. the same request again → 200 with the same request_id");
    const other = Buffer.concat([video, Buffer.from([0])]);
    const clash = await post(launch, multipart(other, { ...meta, checksum_sha256: createHash("sha256").update(other).digest("hex") }));
    check(clash.status === 409 && (await json(clash)).code === "duplicate_request", "   …the same script with another checksum → 409 duplicate_request");
    check((await db.launchRequest.count({ where: { vpId } })) === 1, "   …exactly one request row");

    // 6. the worker runs the intake; the status is derived
    const stats = await processPendingRequests();
    const status = await json(await readRequest(new Request("http://x", { headers: auth(read) }), { params: { id } }));
    check(["preparing", "awaiting_approval"].includes(String(status.status)), `6. worker ran (${JSON.stringify(stats)}) → ${status.status} — in dry-run the Meta upload is not sent, so the creative stays «ready» without a video id → «preparing» is the right answer`);
    const row = await db.launchRequest.findUniqueOrThrow({ where: { id } });
    const asset = await db.creativeAsset.findUnique({ where: { crCode: row.crCode ?? "" } });
    check(!!asset && asset.sourceRef === vpId && asset.productCode === "TRF01" && row.filePath === null, `   …registered as ${row.crCode} (${asset?.status}, policy ${asset?.policyFlag}), product TRF01, the stored file removed`);
    const noRead = await readRequest(new Request("http://x"), { params: { id } });
    check(noRead.status === 401, "   …reading without a token → 401");
    const missing = await readRequest(new Request("http://x", { headers: auth(read) }), { params: { id: "nope" } });
    check(missing.status === 404, "   …an unknown request → 404 not_found");
    // the studio sends nothing but its own fields, and the body has only the contract's keys
    check(JSON.stringify(Object.keys(status).sort()) === JSON.stringify(["ad_id", "adset_id", "campaign_id", "error_code", "landing_page_id", "ops_url", "reason", "request_id", "status"]), "   …the body has exactly the contract's keys");

    // 7. cancel: a read token cannot; once yes, twice → 409
    const c0 = await cancel(new Request("http://x", { method: "POST", headers: auth(read) }), { params: { id } });
    check(c0.status === 403, "7. cancel with a read token → 403");
    const c1 = await cancel(new Request("http://x", { method: "POST", headers: auth(launch) }), { params: { id } });
    const c1b = await json(c1);
    check(c1.status === 200 && c1b.status === "cancelled", "   …cancel → 200 cancelled");
    const c2 = await cancel(new Request("http://x", { method: "POST", headers: auth(launch) }), { params: { id } });
    check(c2.status === 409 && (await json(c2)).code === "cannot_cancel", "   …cancel again → 409 cannot_cancel");
    const after = await json(await readRequest(new Request("http://x", { headers: auth(read) }), { params: { id } }));
    check(after.status === "cancelled", "   …and the status now reads cancelled");
    // an ended request may be sent again: it is a new request
    const resend = await json(await post(launch, multipart(video, meta)));
    check(typeof resend.request_id === "string" && resend.request_id !== id, "   …after it ended, the same script can be sent again (a new request)");

    // 8. product facts: only what we know
    const pm = await productMarket(new Request("http://x/api/vidpattern/product-market?product=TRF01&country=SY", { headers: auth(read) }));
    const facts = await json(pm);
    check(pm.status === 200 && facts.cod === true && "price" in facts && !("offer_tiers" in facts) && !("guarantee" in facts), `8. product-market TRF01/SY → ${JSON.stringify(facts)} (no offer_tiers, no guarantee)`);
    const alt = await productFacts(new Request("http://x/api/v1/vp/products/TRF01/facts?country=SY", { headers: auth(read) }), { params: { id: "TRF01" } });
    check(alt.status === 200 && JSON.stringify(await json(alt)) === JSON.stringify(facts), "   …the alias path answers the same body");
    const none = await productMarket(new Request("http://x/api/vidpattern/product-market?product=ZZZ99&country=SY", { headers: auth(read) }));
    check(none.status === 404, "   …an unknown product → 404 not_found");
    const noTokenPm = await productMarket(new Request("http://x/api/vidpattern/product-market?product=TRF01"));
    check(noTokenPm.status === 401, "   …no token → 401");

    // 9. a studio token is not a site session: it can never approve (a made-up change id, nothing real is touched)
    process.env.AUTH_REQUIRED = "1";
    const viaMiddleware = await middleware(new NextRequest("http://x/api/changes/nope", { method: "POST", headers: { ...auth(launch), "content-type": "application/json" }, body: JSON.stringify({ action: "approve" }) }));
    check(viaMiddleware.status === 401, `9. a vp:launch token on /api/changes/<id> (approval) → the middleware answers ${viaMiddleware.status}, not 200 — the site's approval needs a person's session`);
  } finally {
    await db.launchRequest.deleteMany({ where: { vpId: { startsWith: "VP-TRF01-9" } } });
    await db.apiToken.deleteMany({ where: { id: { in: [tRead?.id, tLaunch?.id].filter((x): x is string => !!x) } } });
    rmSync(work, { recursive: true, force: true });
  }
  process.exit();
})();
