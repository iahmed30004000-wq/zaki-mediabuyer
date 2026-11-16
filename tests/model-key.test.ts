import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkKeyShape, keyHint } from "@/core/model-key";
import { verifyAnthropicKey } from "@/server/assistant/connection";

// built piece by piece: the secret scan must never see a key-looking literal in the repo
const GOOD = "sk-ant-" + "api03-" + "x".repeat(40);

describe("the key the owner pastes", () => {
  it("takes a real-looking key, trims the paste and drops wrapping quotes", () => {
    expect(checkKeyShape(`  ${GOOD}\n`)).toEqual({ ok: true, key: GOOD });
    expect(checkKeyShape(`"${GOOD}"`)).toEqual({ ok: true, key: GOOD });
  });

  it("refuses what is not a Claude key, each with a reason in Arabic", () => {
    const bad: unknown[] = [undefined, null, 42, "", "   ", "sk-proj-" + "a".repeat(50), "sk-ant-short", GOOD + " " + GOOD, GOOD + "‮", "sk-ant-" + "x".repeat(500)];
    for (const b of bad) {
      const r = checkKeyShape(b);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/[؀-ۿ]/);
    }
  });

  it("the hint is the last four characters and nothing more", () => {
    expect(keyHint(GOOD)).toBe("…xxxx");
    expect(keyHint("sk-ant-" + "a".repeat(40) + "WXYZ")).toBe("…WXYZ");
    expect(keyHint(GOOD)).not.toContain("sk-ant");
  });
});

describe("asking Anthropic whether the key is good (a local stand-in for Anthropic)", () => {
  let server: http.Server;
  let base = "";
  let status = 200;
  const seen: { url?: string; auth?: string }[] = [];

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(status === 200 ? JSON.stringify({ data: [], has_more: false, first_id: null, last_id: null }) : JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  it("a good key: one models-list call, with the key in the Authorization header (how the SDK sends it) and nothing else sent", async () => {
    status = 200;
    seen.length = 0;
    await expect(verifyAnthropicKey(GOOD, base)).resolves.toBeUndefined();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.url).toMatch(/^\/v1\/models/);
    expect(seen[0]!.auth).toBe(`Bearer ${GOOD}`);
  });

  it("401 and 403 become a sentence the owner can act on, 400-class", async () => {
    for (const s of [401, 403]) {
      status = s;
      await expect(verifyAnthropicKey(GOOD, base)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/[؀-ۿ]/) });
    }
  });

  it("a server error or a closed port says «try again», 502, and never carries the key", async () => {
    status = 500;
    const e1 = await verifyAnthropicKey(GOOD, base).catch((e) => e);
    expect(e1).toMatchObject({ status: 502 });
    const e2 = await verifyAnthropicKey(GOOD, "http://127.0.0.1:1").catch((e) => e);
    expect(e2).toMatchObject({ status: 502 });
    expect(String(e1.message) + String(e2.message)).not.toContain(GOOD);
  });
});
