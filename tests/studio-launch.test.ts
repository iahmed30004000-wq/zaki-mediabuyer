import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CANCELLABLE, deriveStatus, duplicateDecision, ENDED, LaunchMetaSchema, productCodeOf, productFacts, STATUSES } from "@/core/studio-launch";
import { boundaryOf, MultipartError, readMultipart } from "@/server/multipart";

const sha = "a".repeat(64);
const meta = {
  vp_id: "VP-TRF01-0012-v2", product_id: "123", store_id: "9", country: "SY", mode: "test", framework: "PAS", pattern_id: "P1",
  hook_line: "هل جربت؟", dialect: "شامي", duration_sec: 47, character_id: null, script_text: "نص", captions_srt: "1\n00:00:00,000 --> 00:00:02,000\nنص", checksum_sha256: sha,
};

describe("LaunchMetaSchema", () => {
  it("accepts a full meta, with the optional parts", () => {
    expect(LaunchMetaSchema.safeParse(meta).success).toBe(true);
    expect(LaunchMetaSchema.safeParse({ ...meta, thumbnail: "AAAA", hook_group: "g", hook_index: 2 }).success).toBe(true);
    expect(LaunchMetaSchema.safeParse({ ...meta, product_id: 55 }).data?.product_id).toBe("55");
  });
  it("refuses a missing script, a mode we do not know, a bad checksum, a bad id or country", () => {
    const { script_text: _s, ...noScript } = meta;
    void _s;
    expect(LaunchMetaSchema.safeParse(noScript).success).toBe(false);
    expect(LaunchMetaSchema.safeParse({ ...meta, mode: "live" }).success).toBe(false);
    expect(LaunchMetaSchema.safeParse({ ...meta, checksum_sha256: "xyz" }).success).toBe(false);
    expect(LaunchMetaSchema.safeParse({ ...meta, checksum_sha256: sha.toUpperCase() }).success).toBe(false);
    expect(LaunchMetaSchema.safeParse({ ...meta, vp_id: "CR00147" }).success).toBe(false);
    expect(LaunchMetaSchema.safeParse({ ...meta, country: "Syria" }).success).toBe(false);
  });
});

describe("productCodeOf", () => {
  it("reads our code from the script id, never guesses", () => {
    expect(productCodeOf("VP-TRF01-0012-v2")).toBe("TRF01");
    expect(productCodeOf("VP-TRF01-0012-v2-h3")).toBe("TRF01");
    expect(productCodeOf("VP-kama-109-v2")).toBeNull();
  });
});

describe("duplicateDecision", () => {
  it("no earlier request, or an ended one → a new request", () => {
    expect(duplicateDecision(null, sha)).toBe("new");
    for (const status of ENDED) expect(duplicateDecision({ status, checksum: sha }, sha)).toBe("new");
  });
  it("same checksum while open → the same request; another checksum → conflict", () => {
    for (const status of [...CANCELLABLE, "launched"]) {
      expect(duplicateDecision({ status, checksum: sha }, sha)).toBe("same");
      expect(duplicateDecision({ status, checksum: "b".repeat(64) }, sha)).toBe("conflict");
    }
  });
});

describe("deriveStatus (HANDOFF E1.4)", () => {
  const r = { closedStatus: null, reason: null, crCode: "CR00001" };
  const asset = { status: "ready", policyFlag: "green", policyNote: null, dupOf: null, metaVideoId: null };
  it("received → preparing → awaiting_approval, one row each", () => {
    expect(deriveStatus({ ...r, crCode: null }, null, null).status).toBe("received");
    expect(deriveStatus(r, asset, null).status).toBe("preparing");
    expect(deriveStatus(r, { ...asset, status: "review", policyFlag: "yellow" }, null).status).toBe("preparing");
    expect(deriveStatus(r, { ...asset, metaVideoId: "v1", status: "uploaded" }, null).status).toBe("awaiting_approval");
    expect(deriveStatus(r, { ...asset, metaVideoId: "v1" }, null).status).toBe("awaiting_approval");
    expect(deriveStatus(r, asset, { state: "pending_approval", error: null }).status).toBe("awaiting_approval");
  });
  it("launched when the launch change set executed", () => {
    expect(deriveStatus(r, { ...asset, status: "live" }, { state: "executed", error: null })).toEqual({ status: "launched", reason: null });
  });
  it("rejected: policy red, excluded, a duplicate, or the owner said no — with the reason", () => {
    expect(deriveStatus(r, { ...asset, status: "excluded", policyFlag: "red", policyNote: "ادعاء علاجي" }, null)).toEqual({ status: "rejected", reason: "ادعاء علاجي" });
    expect(deriveStatus(r, { ...asset, policyFlag: "red", policyNote: "x" }, null).status).toBe("rejected");
    expect(deriveStatus(r, { ...asset, status: "excluded", dupOf: "CR00009" }, null)).toEqual({ status: "rejected", reason: "نسخة من CR00009" });
    expect(deriveStatus(r, asset, { state: "rejected", error: null }).status).toBe("rejected");
  });
  it("failed: a dead upload, a failed change set, or a broken file closed by the intake", () => {
    expect(deriveStatus(r, { ...asset, status: "dead" }, null).status).toBe("failed");
    expect(deriveStatus(r, asset, { state: "failed", error: "ميتا رفضت" })).toEqual({ status: "failed", reason: "ميتا رفضت" });
    expect(deriveStatus({ closedStatus: "failed", reason: "ملف تالف", crCode: null }, null, null)).toEqual({ status: "failed", reason: "ملف تالف" });
  });
  it("priority: cancelled beats everything, executed beats the asset's state", () => {
    expect(deriveStatus({ ...r, closedStatus: "cancelled", reason: "ألغاه" }, { ...asset, metaVideoId: "v" }, { state: "executed", error: null }).status).toBe("cancelled");
    expect(deriveStatus(r, { ...asset, status: "dead", policyFlag: "red" }, { state: "executed", error: null }).status).toBe("launched");
  });
  it("only ever answers a status the studio knows", () => {
    for (const a of [null, asset]) for (const c of [null, { state: "executed", error: null }, { state: "approved", error: null }]) expect(STATUSES).toContain(deriveStatus(r, a, c).status);
  });
});

describe("productFacts (only what we know)", () => {
  const e = { market: "SY", price: "24.50", deliveryFee: "2" };
  it("sends price, country, cod and the delivery fee — never offer_tiers or guarantee", () => {
    const f = productFacts(e, "SY")!;
    expect(f).toEqual({ price: { amount: 24.5, currency: "USD" }, country: "SY", cod: true, delivery: { fee: 2 } });
    expect("offer_tiers" in f).toBe(false);
    expect("guarantee" in f).toBe(false);
  });
  it("another market than ours → nothing; no market asked → ours", () => {
    expect(productFacts(e, "JO")).toBeNull();
    expect(productFacts(e, null)?.country).toBe("SY");
  });
  it("a zero price is unknown, not «free»", () => {
    expect(productFacts({ ...e, price: "0" }, null)).not.toHaveProperty("price");
  });
});

describe("multipart: streamed to disk, limited while reading", () => {
  const B = "----mbtest123";
  const part = (name: string, body: string | Buffer, filename?: string) =>
    Buffer.concat([Buffer.from(`--${B}\r\nContent-Disposition: form-data; name="${name}"${filename ? `; filename="${filename}"` : ""}\r\n${filename ? "Content-Type: video/mp4\r\n" : ""}\r\n`), Buffer.from(body), Buffer.from("\r\n")]);
  const end = Buffer.from(`--${B}--\r\n`);
  async function* chunks(buf: Buffer, size: number) {
    for (let i = 0; i < buf.length; i += size) yield new Uint8Array(buf.subarray(i, i + size));
  }
  const opts = async (max = 1_000_000) => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "mb-mp-"));
    return { dir, o: { fileField: "video", filePath: path.join(dir, "sub", "f.part"), maxFileBytes: max, maxFieldBytes: 10_000 } };
  };
  // binary with bytes that look like framing, to prove the delimiter search is not fooled
  const video = Buffer.concat([Buffer.from("\r\n--not-the-boundary\r\n"), Buffer.alloc(5000, 7), Buffer.from(`\r\n--${B.slice(0, -2)}`), Buffer.from([0, 255, 13, 10])]);

  it("reads the file and the meta whatever the chunk size, with the right sha256", async () => {
    const body = Buffer.concat([part("meta", '{"a":"عربي"}'), part("video", video, "VP-TRF01-0012-v2.mp4"), end]);
    for (const size of [1, 3, 7, 64, 100_000]) {
      const { dir, o } = await opts();
      const out = await readMultipart(chunks(body, size), B, o);
      expect(out.fields.meta).toBe('{"a":"عربي"}');
      expect(out.file).toEqual({ bytes: video.length, sha256: createHash("sha256").update(video).digest("hex"), filename: "VP-TRF01-0012-v2.mp4" });
      expect((await readFile(o.filePath)).equals(video)).toBe(true);
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("also when the video comes before the meta", async () => {
    const { dir, o } = await opts();
    const out = await readMultipart(chunks(Buffer.concat([part("video", video, "a.mp4"), part("meta", "{}"), end]), 11), B, o);
    expect(out.fields.meta).toBe("{}");
    expect(out.file?.bytes).toBe(video.length);
    await rm(dir, { recursive: true, force: true });
  });
  it("stops at the limit while reading and leaves no file behind", async () => {
    const { dir, o } = await opts(1000);
    await expect(readMultipart(chunks(Buffer.concat([part("video", Buffer.alloc(5000, 1), "a.mp4"), end]), 512), B, o)).rejects.toMatchObject({ code: "file_too_large" });
    await expect(stat(o.filePath)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
  it("refuses a text field over its cap, a cut-off body and garbage", async () => {
    const { dir, o } = await opts();
    await expect(readMultipart(chunks(Buffer.concat([part("meta", "x".repeat(20_000)), end]), 999), B, o)).rejects.toMatchObject({ code: "field_too_large" });
    await expect(readMultipart(chunks(part("video", video, "a.mp4"), 999), B, o)).rejects.toBeInstanceOf(MultipartError);
    await expect(readMultipart(chunks(Buffer.from("not multipart at all"), 5), B, o)).rejects.toBeInstanceOf(MultipartError);
    await expect(stat(o.filePath)).rejects.toThrow();
    await rm(dir, { recursive: true, force: true });
  });
  it("finds the boundary in the content type", () => {
    expect(boundaryOf("multipart/form-data; boundary=abc123")).toBe("abc123");
    expect(boundaryOf('multipart/form-data; boundary="a b"')).toBe("a b");
    expect(boundaryOf("application/json")).toBeNull();
    expect(boundaryOf(null)).toBeNull();
  });
});
