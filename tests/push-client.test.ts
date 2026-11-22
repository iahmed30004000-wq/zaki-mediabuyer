/**
 * Push on the device (src/lib/push-client.ts) with the browser and Firebase pretended: the permission is asked only from a press and only when Firebase is set up, an iPhone that has not installed
 * the site gets «ios_install» instead of a try, the Installation ID goes to the server, a refresh asks nothing, «شيله» tells the server and Firebase, and nothing breaks when storage is blocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fb = vi.hoisted(() => ({
  registered: [] as { options: any }[],
  unregistered: 0,
  fid: "fid-of-this-phone-0001",
  supported: true,
  apps: [] as unknown[],
  inits: [] as any[],
}));
vi.mock("@firebase/app", () => ({
  initializeApp: (cfg: any) => {
    fb.inits.push(cfg);
    fb.apps.push({ cfg });
    return fb.apps[fb.apps.length - 1];
  },
  getApps: () => fb.apps,
  getApp: () => fb.apps[0],
}));
vi.mock("@firebase/messaging", () => {
  const listeners: ((id: string) => void)[] = [];
  return {
    isSupported: async () => fb.supported,
    getMessaging: () => ({ m: 1 }),
    onRegistered: (_m: unknown, cb: (id: string) => void) => {
      listeners.push(cb);
      return () => void listeners.splice(listeners.indexOf(cb), 1);
    },
    register: async (_m: unknown, options: any) => {
      fb.registered.push({ options });
      queueMicrotask(() => [...listeners].forEach((l) => l(fb.fid)));
    },
    unregister: async () => void (fb.unregistered += 1),
  };
});

import { currentPushState, disablePush, enablePush, refreshPush, setBadge, thisDeviceId } from "@/lib/push-client";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
const CONFIG = { configured: true, missing: [], web: { apiKey: "k", projectId: "p", messagingSenderId: "1", appId: "a", vapidKey: "v" } };

const calls: { url: string; method: string; body: any }[] = [];
let permission: "default" | "granted" | "denied";
let asked = 0;
let store: Record<string, string>;
let storageBlocked = false;
let configAnswer: unknown;
let serverAnswer: { ok: boolean; status: number; body: unknown };

function world(ua: string, over: { standalone?: boolean; pushManager?: boolean } = {}) {
  const sw = { registered: [] as string[] };
  const registration = { pushManager: {} };
  vi.stubGlobal("navigator", {
    userAgent: ua,
    standalone: over.standalone,
    serviceWorker: { getRegistration: async () => (sw.registered.length ? registration : undefined), register: async (u: string) => void sw.registered.push(u), ready: Promise.resolve(registration) },
    setAppBadge: vi.fn(async () => undefined),
    clearAppBadge: vi.fn(async () => undefined),
  });
  const Notif = function () {} as unknown as Record<string, unknown>;
  Object.defineProperty(Notif, "permission", { get: () => permission });
  Notif.requestPermission = async () => {
    asked += 1;
    permission = permission === "default" ? "granted" : permission;
    return permission;
  };
  vi.stubGlobal("Notification", Notif);
  vi.stubGlobal("window", { PushManager: over.pushManager === false ? undefined : function () {} });
  if (over.pushManager === false) delete (globalThis as any).window.PushManager;
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => {
      if (storageBlocked) throw new Error("blocked");
      return store[k] ?? null;
    },
    setItem: (k: string, v: string) => {
      if (storageBlocked) throw new Error("blocked");
      store[k] = v;
    },
    removeItem: (k: string) => {
      if (storageBlocked) throw new Error("blocked");
      delete store[k];
    },
  });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init.method ?? "GET", body });
    if (url === "/api/push/config") return new Response(JSON.stringify(configAnswer), { status: 200 });
    return new Response(JSON.stringify(serverAnswer.body), { status: serverAnswer.status });
  });
  return sw;
}

beforeEach(() => {
  calls.length = 0;
  permission = "default";
  asked = 0;
  store = {};
  storageBlocked = false;
  configAnswer = CONFIG;
  serverAnswer = { ok: true, status: 200, body: { ok: true, device: { id: "dev-1" } } };
  fb.registered.length = 0;
  fb.unregistered = 0;
  fb.apps.length = 0;
  fb.inits.length = 0;
  fb.supported = true;
});
afterEach(() => vi.unstubAllGlobals());

describe("turning it on (from a press)", () => {
  it("asks for the permission, registers with Firebase through OUR service worker, and tells the server the Installation ID with this phone's name", async () => {
    const sw = world(ANDROID);
    const r = await enablePush();
    expect(r).toEqual({ ok: true, deviceId: "dev-1" });
    expect(asked).toBe(1);
    expect(sw.registered).toEqual(["/sw.js"]); // none was there yet (the dev server): ours is registered, never a second firebase-messaging-sw.js
    expect(fb.inits).toEqual([{ apiKey: "k", projectId: "p", messagingSenderId: "1", appId: "a" }]); // the four public values — not the vapid key
    expect(fb.registered[0]!.options.vapidKey).toBe("v");
    expect(fb.registered[0]!.options.serviceWorkerRegistration).toBeTruthy();
    const post = calls.find((c) => c.url === "/api/push/devices")!;
    expect(post).toMatchObject({ method: "POST", body: { token: fb.fid, kind: "fcm_fid", platform: "android", label: "أندرويد · Chrome" } });
    expect(thisDeviceId()).toBe("dev-1");
    expect(currentPushState()).toBe("granted");
  });

  it("not set up: it says so and does NOT ask for the permission (no point in a prompt that leads nowhere)", async () => {
    world(ANDROID);
    configAnswer = { configured: false, missing: ["FIREBASE_APP_ID"], web: null };
    const r = await enablePush();
    expect(r).toMatchObject({ ok: false, reason: "setup_needed" });
    expect(asked).toBe(0);
    expect(fb.registered).toHaveLength(0);
    expect(calls.some((c) => c.url === "/api/push/devices")).toBe(false);
  });

  it("the person says no: «denied», and nothing is sent to the server", async () => {
    world(ANDROID);
    vi.stubGlobal("Notification", Object.assign(function () {}, { permission: "default", requestPermission: async () => "denied" }));
    const r = await enablePush();
    expect(r).toMatchObject({ ok: false, reason: "denied" });
    expect(calls.some((c) => c.url === "/api/push/devices")).toBe(false);
  });

  it("already refused in the browser's settings: «denied» without asking again", async () => {
    world(ANDROID);
    permission = "denied";
    expect(currentPushState()).toBe("denied");
    expect(await enablePush()).toMatchObject({ ok: false, reason: "denied" });
    expect(asked).toBe(0);
  });

  it("an iPhone that has not installed the site: «ios_install» — no try; installed, it is a normal browser", async () => {
    world(IPHONE, { pushManager: false });
    expect(currentPushState()).toBe("ios_install");
    expect(await enablePush()).toMatchObject({ ok: false, reason: "ios_install" });
    expect(asked).toBe(0);
    world(IPHONE, { standalone: true });
    expect(currentPushState()).toBe("ready");
  });

  it("a browser Firebase does not support, or the server refusing the device: a sentence, never a crash", async () => {
    world(ANDROID);
    fb.supported = false;
    expect(await enablePush()).toMatchObject({ ok: false, reason: "unsupported" });
    fb.supported = true;
    serverAnswer = { ok: false, status: 400, body: { error: "بيانات الجهاز مش صحيحة" } };
    expect(await enablePush()).toMatchObject({ ok: false, reason: "failed" });
  });

  it("with the storage blocked (a private window) it still works; only the memory of «this device» is lost", async () => {
    world(ANDROID);
    storageBlocked = true;
    expect(await enablePush()).toEqual({ ok: true, deviceId: "dev-1" });
    expect(thisDeviceId()).toBeNull();
  });
});

describe("every open of the site", () => {
  it("a phone that registered and is still allowed renews its registration — no prompt", async () => {
    world(ANDROID);
    await enablePush();
    calls.length = 0;
    asked = 0;
    await refreshPush();
    expect(asked).toBe(0);
    expect(calls.filter((c) => c.url === "/api/push/devices")).toHaveLength(1);
  });

  it("does nothing for a browser that never registered, or one whose permission was taken back", async () => {
    world(ANDROID);
    await refreshPush();
    expect(calls).toHaveLength(0);
    await enablePush();
    calls.length = 0;
    permission = "denied";
    await refreshPush();
    expect(calls).toHaveLength(0);
  });
});

describe("«شيله»", () => {
  it("Firebase forgets the phone, the server stops pushing to it (by its token), and the memory is cleared", async () => {
    world(ANDROID);
    await enablePush();
    calls.length = 0;
    await disablePush();
    expect(fb.unregistered).toBe(1);
    expect(calls.find((c) => c.method === "DELETE")).toMatchObject({ url: "/api/push/devices", body: { token: fb.fid } });
    expect(thisDeviceId()).toBeNull();
  });
});

describe("the number on the icon", () => {
  it("is set when something is unread (capped at 99) and cleared when not; a browser without it is fine", () => {
    world(ANDROID);
    const nav = navigator as any;
    setBadge(7);
    setBadge(250);
    setBadge(0);
    expect(nav.setAppBadge.mock.calls).toEqual([[7], [99]]);
    expect(nav.clearAppBadge).toHaveBeenCalledTimes(1);
    vi.stubGlobal("navigator", { userAgent: ANDROID });
    expect(() => setBadge(3)).not.toThrow();
  });
});
