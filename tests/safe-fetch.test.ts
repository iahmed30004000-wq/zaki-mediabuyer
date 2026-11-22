/**
 * The studio's video URL: public https only, every hop checked, the size counted while it streams.
 */
import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { OutboundRefused, allowListFrom, byteLimit, checkOutbound, safeGet } from "@/server/safe-fetch";

const resolveTo = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];
const publicHost = resolveTo({ "cdn.example.com": ["93.184.216.34"], "studio.zakiai.io": ["203.0.113.9"] });

describe("checkOutbound", () => {
  const refused = async (url: string, allow: string[] = []) => checkOutbound(url, allow, { resolve: publicHost }).then(() => null, (e: Error) => e);

  it("lets a public https address through", async () => {
    expect(await refused("https://cdn.example.com/v.mp4")).toBeNull();
  });

  it("refuses what is not https, carries a login, or uses another port", async () => {
    expect(await refused("http://cdn.example.com/v.mp4")).toBeInstanceOf(OutboundRefused);
    expect(await refused("https://user:pw@cdn.example.com/v.mp4")).toBeInstanceOf(OutboundRefused);
    expect(await refused("https://cdn.example.com:8443/v.mp4")).toBeInstanceOf(OutboundRefused);
    expect(await refused("ftp://cdn.example.com/v.mp4")).toBeInstanceOf(OutboundRefused);
    expect(await refused("not a url")).toBeInstanceOf(OutboundRefused);
  });

  it("refuses this machine, the private ranges and link-local addresses, as names and as numbers", async () => {
    for (const u of ["https://localhost/x", "https://db.internal/x", "https://printer.local/x", "https://127.0.0.1/x", "https://10.1.2.3/x", "https://192.168.1.5/x", "https://169.254.169.254/latest/meta-data", "https://[::1]/x", "https://[fd00::1]/x", "https://[::ffff:127.0.0.1]/x"]) {
      expect(await refused(u), u).toBeInstanceOf(OutboundRefused);
    }
  });

  it("refuses a public-looking name that points inside (and one that does not resolve)", async () => {
    const d = { resolve: resolveTo({ "evil.example.com": ["10.0.0.7"], "mixed.example.com": ["93.184.216.34", "127.0.0.1"] }) };
    await expect(checkOutbound("https://evil.example.com/x", [], d)).rejects.toBeInstanceOf(OutboundRefused);
    await expect(checkOutbound("https://mixed.example.com/x", [], d)).rejects.toBeInstanceOf(OutboundRefused);
    await expect(checkOutbound("https://nowhere.example.com/x", [], d)).rejects.toBeInstanceOf(OutboundRefused);
  });

  it("honours the owner's list when there is one", async () => {
    expect(await refused("https://cdn.example.com/v.mp4", ["*.zakiai.io"])).toBeInstanceOf(OutboundRefused);
    expect(await refused("https://studio.zakiai.io/v.mp4", ["*.zakiai.io"])).toBeNull();
    expect(allowListFrom(" *.zakiai.io, Cdn.Example.com ")).toEqual(["*.zakiai.io", "cdn.example.com"]);
    expect(allowListFrom(undefined)).toEqual([]);
  });
});

describe("safeGet", () => {
  const ok = () => new Response("video", { status: 200 });
  const redirect = (to: string) => new Response(null, { status: 302, headers: { location: to } });

  it("never lets fetch follow a redirect by itself", async () => {
    const f = vi.fn().mockResolvedValue(ok());
    await safeGet("https://cdn.example.com/v.mp4", { allow: [], timeoutMs: 1000 }, { fetch: f as never, resolve: publicHost });
    expect(f.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("follows a redirect to another public host, checking it again", async () => {
    const f = vi.fn().mockResolvedValueOnce(redirect("https://studio.zakiai.io/real.mp4")).mockResolvedValueOnce(ok());
    const res = await safeGet("https://cdn.example.com/v.mp4", { allow: [], timeoutMs: 1000 }, { fetch: f as never, resolve: publicHost });
    expect(res.status).toBe(200);
    expect(f.mock.calls.map((c) => c[0])).toEqual(["https://cdn.example.com/v.mp4", "https://studio.zakiai.io/real.mp4"]);
  });

  it("a redirect that points inside is refused — and never fetched", async () => {
    for (const to of ["http://169.254.169.254/latest", "https://127.0.0.1/admin", "https://localhost:3140/api/health", "/relative-is-fine-but-same-host-checked"]) {
      const f = vi.fn().mockResolvedValue(redirect(to));
      const run = safeGet("https://cdn.example.com/v.mp4", { allow: [], timeoutMs: 1000 }, { fetch: f as never, resolve: publicHost });
      if (to.startsWith("/")) {
        // a relative hop stays on the same checked host; it ends at the redirect limit
        await expect(run).rejects.toBeInstanceOf(OutboundRefused);
      } else {
        await expect(run).rejects.toBeInstanceOf(OutboundRefused);
        expect(f).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("stops after three redirects", async () => {
    const f = vi.fn().mockImplementation(async () => redirect("https://cdn.example.com/again"));
    await expect(safeGet("https://cdn.example.com/v.mp4", { allow: [], timeoutMs: 1000 }, { fetch: f as never, resolve: publicHost })).rejects.toThrow(/تحويلات/);
    expect(f).toHaveBeenCalledTimes(4);
  });
});

describe("byteLimit", () => {
  const run = (chunks: number[], max: number) => pipeline(Readable.from(chunks.map((n) => Buffer.alloc(n))), byteLimit(max, () => new Error("too big")), new (require("node:stream").Writable)({ write: (_c: unknown, _e: unknown, cb: () => void) => cb() }));
  it("lets a body up to the limit through", async () => {
    await expect(run([400, 600], 1000)).resolves.toBeUndefined();
  });
  it("fails the moment the body passes the limit, whatever a header said", async () => {
    await expect(run([400, 400, 400], 1000)).rejects.toThrow("too big");
  });
});
