/**
 * The service worker (public/sw.js), run in a small pretend of the worker's world: the version is the deploy's (N-15), a page that opened really is kept, the results page is the fallback,
 * signing out empties the caches (S-23), and the push is shown from the payload — with no Firebase library in the file at all (05-notify.md §6).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const SRC = readFileSync(path.resolve(__dirname, "..", "public", "sw.js"), "utf8");

type Handler = (e: any) => void;

class FakeResponse {
  cloned = 0;
  bodyUsed = false;
  constructor(public url: string, public ok = true, public redirected = false) {}
  clone() {
    if (this.bodyUsed) throw new TypeError("Response body is already used");
    this.cloned += 1;
    return new FakeResponse(this.url, this.ok, this.redirected);
  }
}

function boot(version: string | null = "abc1234") {
  const handlers: Record<string, Handler> = {};
  const stores = new Map<string, Map<string, FakeResponse>>();
  const shown: { title: string; options: any }[] = [];
  const opened: string[] = [];
  const badge: (number | "clear")[] = [];
  let windows: { url: string; focus: () => Promise<any>; navigate?: (u: string) => Promise<any> }[] = [];
  const cache = (n: string) => {
    if (!stores.has(n)) stores.set(n, new Map());
    const m = stores.get(n)!;
    return { put: async (req: any, res: FakeResponse) => void m.set(typeof req === "string" ? req : req.url, res), addAll: async (urls: string[]) => urls.forEach((u) => m.set(new URL(u, "https://mb.test").href, new FakeResponse(u))) };
  };
  const caches = {
    open: async (n: string) => cache(n),
    keys: async () => [...stores.keys()],
    delete: async (n: string) => stores.delete(n),
    match: async (req: any) => {
      const key = typeof req === "string" ? new URL(req, "https://mb.test").href : req.url;
      for (const m of stores.values()) if (m.has(key)) return m.get(key);
      return undefined;
    },
  };
  const net: { handler: (req: any) => Promise<FakeResponse> } = { handler: async (r) => new FakeResponse(r.url) };
  const fetchImpl = async (req: any) => {
    const url = typeof req === "string" ? req : req.url;
    if (url.startsWith("/api/notifications")) return { ok: true, json: async () => ({ unread: 7 }) };
    return net.handler(typeof req === "string" ? { url: req } : req);
  };
  const self: any = {
    location: { href: `https://mb.test/sw.js${version === null ? "" : `?v=${version}`}`, origin: "https://mb.test" },
    addEventListener: (type: string, h: Handler) => void (handlers[type] = h),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(async () => undefined), matchAll: async () => windows, openWindow: async (u: string) => void opened.push(u) },
    registration: { showNotification: async (title: string, options: any) => void shown.push({ title, options }) },
    navigator: { setAppBadge: async (n: number) => void badge.push(n), clearAppBadge: async () => void badge.push("clear") },
  };
  const ctx = vm.createContext({ self, caches, fetch: fetchImpl, URL, Promise, console, clients: self.clients, Response: FakeResponse });
  vm.runInContext(SRC, ctx);
  /** dispatches an event and returns what it waited on / answered */
  async function fire(type: string, e: Record<string, any>): Promise<{ answered: any; responded: boolean }> {
    const waits: Promise<unknown>[] = [];
    let answered: Promise<unknown> | null = null as Promise<unknown> | null;
    handlers[type]!({ ...e, waitUntil: (p: Promise<unknown>) => void waits.push(p), respondWith: (p: Promise<unknown>) => void (answered = p) });
    await Promise.all(waits);
    const responded = answered !== null;
    return { answered: responded ? await answered : undefined, responded };
  }
  return { fire, stores, shown, opened, badge, net, self, setWindows: (w: typeof windows) => void (windows = w), handlers };
}

const nav = (url: string) => ({ request: { url: `https://mb.test${url}`, method: "GET", mode: "navigate" } });

describe("the version is the deploy's", () => {
  it("`/sw.js?v=<version>` names its caches; activating drops every cache of another version and keeps its own", async () => {
    const w = boot("v-new");
    await w.fire("install", {});
    expect([...w.stores.keys()]).toEqual(["mb-v-new-pages"]);
    w.stores.set("mb-v-old-pages", new Map());
    w.stores.set("mb-v-old-static", new Map());
    w.stores.set("mb-v-new-static", new Map());
    w.stores.set("somebody-else", new Map());
    await w.fire("activate", {});
    expect([...w.stores.keys()].sort()).toEqual(["mb-v-new-pages", "mb-v-new-static"]);
    expect(w.self.clients.claim).toHaveBeenCalled();
  });
  it("without a version it is «dev» (the dev server), not a crash", async () => {
    const w = boot(null);
    await w.fire("install", {});
    expect([...w.stores.keys()]).toEqual(["mb-dev-pages"]);
  });
  it("the page registers the worker with the deploy's version in its address", () => {
    const src = readFileSync(path.resolve(__dirname, "..", "src", "components", "pwa-register.tsx"), "utf8");
    expect(src).toMatch(/register\(`\/sw\.js\?v=\$\{encodeURIComponent\(version\)\}`\)/);
    const layout = readFileSync(path.resolve(__dirname, "..", "src", "app", "layout.tsx"), "utf8");
    expect(layout).toContain('<PwaRegister version={process.env.APP_VERSION ?? "dev"} />');
  });
});

describe("pages and files (N-15)", () => {
  it("a page that opened is really kept: the copy is taken before the page reads the body (a late clone is «already used» and nothing was ever kept)", async () => {
    const w = boot();
    const res = new FakeResponse("https://mb.test/work");
    w.net.handler = async () => res;
    const out = await w.fire("fetch", nav("/work"));
    expect(out.answered).toBe(res);
    expect(res.cloned).toBe(1);
    expect(w.stores.get("mb-abc1234-pages")!.has("https://mb.test/work")).toBe(true);
  });
  it("a page that redirected to the door, or failed, is not kept", async () => {
    const w = boot();
    w.net.handler = async () => new FakeResponse("https://mb.test/login", true, true);
    await w.fire("fetch", nav("/inbox"));
    w.net.handler = async () => new FakeResponse("https://mb.test/x", false);
    await w.fire("fetch", nav("/x"));
    expect(w.stores.get("mb-abc1234-pages")?.size ?? 0).toBe(0);
  });
  it("offline: the same page if it was kept, else the results page (`/tasks/results`), else «/offline»", async () => {
    const w = boot();
    await w.fire("install", {});
    w.net.handler = async () => new FakeResponse("https://mb.test/work");
    await w.fire("fetch", nav("/work"));
    w.net.handler = async () => {
      throw new TypeError("offline");
    };
    expect(((await w.fire("fetch", nav("/work"))).answered as FakeResponse).url).toBe("https://mb.test/work");
    expect(((await w.fire("fetch", nav("/never-opened"))).answered as FakeResponse).url).toBe("/offline");
    w.net.handler = async () => new FakeResponse("https://mb.test/tasks/results");
    await w.fire("fetch", nav("/tasks/results"));
    w.net.handler = async () => {
      throw new TypeError("offline");
    };
    expect(((await w.fire("fetch", nav("/never-opened"))).answered as FakeResponse).url).toBe("https://mb.test/tasks/results");
    expect(SRC).not.toContain("/done?tab=reports");
  });
  it("built files: cache first, kept with the same early copy; the API, the login and anything that changes data are never touched", async () => {
    const w = boot();
    const res = new FakeResponse("https://mb.test/_next/static/a.js");
    w.net.handler = async () => res;
    const first = await w.fire("fetch", { request: { url: "https://mb.test/_next/static/a.js", method: "GET", mode: "no-cors" } });
    expect(first.answered).toBe(res);
    expect(res.cloned).toBe(1);
    expect(w.stores.get("mb-abc1234-static")!.size).toBe(1);
    for (const r of [{ url: "https://mb.test/api/approvals/pending", method: "GET", mode: "cors" }, { url: "https://mb.test/login", method: "GET", mode: "navigate" }, { url: "https://mb.test/api/x", method: "POST", mode: "cors" }, { url: "https://other.test/a", method: "GET", mode: "cors" }]) {
      expect((await w.fire("fetch", { request: r })).responded, `${r.method} ${r.url}`).toBe(false);
    }
  });
});

describe("signing out empties what was kept (S-23)", () => {
  it("a POST to the logout address clears every cache (and the request itself is left alone); so does a «clear» message", async () => {
    const w = boot();
    await w.fire("install", {});
    w.net.handler = async () => new FakeResponse("https://mb.test/work");
    await w.fire("fetch", nav("/work"));
    expect(w.stores.size).toBeGreaterThan(0);
    const out = await w.fire("fetch", { request: { url: "https://mb.test/api/auth/logout", method: "POST", mode: "cors" } });
    expect(out.responded).toBe(false);
    expect(w.stores.size).toBe(0);
    expect(w.badge).toContain("clear");
    await w.fire("install", {});
    expect(w.stores.size).toBe(1);
    await w.fire("message", { data: { type: "clear" } });
    expect(w.stores.size).toBe(0);
    await w.fire("install", {});
    await w.fire("message", { data: { type: "something else" } });
    expect(w.stores.size).toBe(1);
  });
});

describe("push", () => {
  const fcm = (over: Record<string, unknown> = {}) => ({ data: { json: () => ({ notification: { title: "بدّها قرارك: تكبير «حرير 3»", body: "اضغط تفتح القرار", tag: "approval.new:n1", requireInteraction: true, silent: false, icon: "https://mb.test/icons/icon-192.png", dir: "rtl", lang: "ar" }, data: { href: "/inbox/approval%3Aa1", id: "n1", kind: "approval.new" }, from: "123", ...over }) } });

  it("shows the notification from FCM's payload: the title and the reason, whether it stays and whether it sounds, and where a tap goes; the number of unread goes on the icon", async () => {
    const w = boot();
    await w.fire("push", fcm());
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]!.title).toBe("بدّها قرارك: تكبير «حرير 3»");
    expect(w.shown[0]!.options).toMatchObject({ body: "اضغط تفتح القرار", tag: "approval.new:n1", requireInteraction: true, silent: false, dir: "rtl", lang: "ar", icon: "https://mb.test/icons/icon-192.png", data: { href: "/inbox/approval%3Aa1", id: "n1", kind: "approval.new" } });
    expect(w.badge).toEqual([7]);
  });

  it("a quiet one is silent and does not stay", async () => {
    const w = boot();
    await w.fire("push", fcm({ notification: { title: "تقرير الصبح جاهز", body: "", silent: true, requireInteraction: false } }));
    expect(w.shown[0]!.options).toMatchObject({ silent: true, requireInteraction: false });
  });

  it("a tap can only land inside the site; an icon from another site is not used", async () => {
    for (const bad of ["https://evil.test/x", "//evil.test", "javascript:alert(1)", "/a\\b", undefined, 5]) {
      const w = boot();
      await w.fire("push", fcm({ data: { href: bad } }));
      expect(w.shown[0]!.options.data.href, String(bad)).toBe("/");
    }
    const w = boot();
    await w.fire("push", fcm({ notification: { title: "x", icon: "https://evil.test/i.png" } }));
    expect(w.shown[0]!.options.icon).toBe("/icons/icon-192.png");
  });

  it("a push that cannot be read, or has no text, still shows something (a push that shows nothing is punished by the browser)", async () => {
    const w = boot();
    await w.fire("push", { data: { json: () => { throw new SyntaxError("x"); } } });
    await w.fire("push", {});
    expect(w.shown.map((s) => s.title)).toEqual(["الميديا باير", "الميديا باير"]);
  });

  it("no Firebase library in the worker: the message is only shown", () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(/firebase|importScripts/i);
  });
});

describe("a tap on a notification", () => {
  const click = (href?: string) => ({ notification: { close: vi.fn(), data: href === undefined ? {} : { href } } });

  it("focuses the tab that is open and takes it to the place", async () => {
    const w = boot();
    const navigate = vi.fn(async () => undefined);
    const win: any = { url: "https://mb.test/work", focus: async () => win, navigate };
    w.setWindows([win]);
    const e = click("/inbox/approval%3Aa1");
    await w.fire("notificationclick", e);
    expect(e.notification.close).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith("https://mb.test/inbox/approval%3Aa1");
    expect(w.opened).toEqual([]);
  });
  it("opens a window when none is open, or when the open one cannot be driven", async () => {
    const w = boot();
    await w.fire("notificationclick", click("/inbox"));
    expect(w.opened).toEqual(["https://mb.test/inbox"]);
    const w2 = boot();
    w2.setWindows([{ url: "https://mb.test/", focus: async () => { throw new Error("no"); } }]);
    await w2.fire("notificationclick", click("/inbox"));
    expect(w2.opened).toEqual(["https://mb.test/inbox"]);
  });
  it("another site's window is not driven; a made-up address goes home; a tap approves nothing (it only opens a page)", async () => {
    const w = boot();
    w.setWindows([{ url: "https://other.test/", focus: async () => { throw new Error("must not be touched"); } }]);
    await w.fire("notificationclick", click("https://evil.test/x"));
    expect(w.opened).toEqual(["https://mb.test/"]);
    expect(SRC).not.toMatch(/method:\s*["']POST["']/);
  });
});
