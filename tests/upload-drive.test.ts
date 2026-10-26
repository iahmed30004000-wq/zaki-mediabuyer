import { describe, expect, it } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { uploadVideo } from "@/meta/video-upload";
import { listChildren, renameMove } from "@/adapters/drive";

describe("Meta video upload (spec 7.4) — the SDK's resumable protocol", () => {
  it("start → transfer chunks → finish → waits for ready", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "mb-up-"));
    const file = path.join(dir, "v.mp4");
    writeFileSync(file, Buffer.alloc(25, 7));
    const phases: string[] = [];
    let statusCalls = 0;
    const f = (async (url: string, init?: RequestInit) => {
      if (url.includes("fields=status")) {
        statusCalls++;
        return new Response(JSON.stringify({ status: { video_status: statusCalls < 2 ? "processing" : "ready" } }));
      }
      const form = init!.body as FormData;
      const phase = String(form.get("upload_phase"));
      phases.push(phase);
      if (phase === "start") return new Response(JSON.stringify({ upload_session_id: "S1", video_id: "V9", start_offset: "0", end_offset: "10" }));
      if (phase === "transfer") {
        const at = Number(form.get("start_offset"));
        return new Response(JSON.stringify(at === 0 ? { start_offset: "10", end_offset: "25" } : { start_offset: "25", end_offset: "25" }));
      }
      expect(form.get("title")).toBe("TRF01_CR00147_a3f9.mp4");
      return new Response(JSON.stringify({ success: true }));
    }) as unknown as typeof fetch;
    const r = await uploadVideo({ token: "t", fetch: f, sleep: async () => {} }, "live", "act_1", file, "TRF01_CR00147_a3f9.mp4");
    expect(phases).toEqual(["start", "transfer", "transfer", "finish"]);
    expect(r).toEqual({ videoId: "V9", status: "ready", attempts: 2 });
  });

  it("dry-run sends nothing", async () => {
    const r = await uploadVideo({ token: "t", fetch: (() => { throw new Error("must not call"); }) as unknown as typeof fetch }, "dry_run", "act_1", "nope.mp4", "x");
    expect(r.status).toBe("dry_run");
  });
});

describe("Google Drive (spec 9.5) — rename and move, never delete", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const account = { client_email: "mb@test.iam.gserviceaccount.com", private_key: privateKey };

  it("signs in as the service account, lists, then renames + moves with one PATCH", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
      if (url.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "ya29.test", expires_in: 3600 }));
      if (url.includes("/files?")) return new Response(JSON.stringify({ files: [{ id: "F1", name: "فيديو.mp4", mimeType: "video/mp4" }] }));
      return new Response(JSON.stringify({ id: "F1" }));
    }) as unknown as typeof fetch;
    const o = { account, fetch: f };
    const files = await listChildren(o, "INBOX");
    expect(files[0]!.name).toBe("فيديو.mp4");
    await renameMove(o, "F1", { name: "TRF01_CR00147_a3f9.mp4", from: "INBOX", to: "READY" });
    const patch = calls.find((c) => c.method === "PATCH")!;
    expect(patch.url).toContain("addParents=READY");
    expect(patch.url).toContain("removeParents=INBOX");
    expect(JSON.parse(patch.body!)).toEqual({ name: "TRF01_CR00147_a3f9.mp4" });
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });
});
