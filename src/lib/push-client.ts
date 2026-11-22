/**
 * PUSH, ON THE DEVICE (docs/rebuild-v6/05-notify.md §6). Runs in the browser only. The Firebase packages are imported when a button is pressed (a dynamic import), never at page load, so the
 * site's own pages carry none of their weight; the service worker (public/sw.js) holds no Firebase library at all — it only shows what arrives.
 *
 * What is used, from the current Firebase JS SDK (messaging 0.13, checked 22/11/2026): `register()` + `onRegistered()` give a Firebase Installation ID, which the server sends to (`fid` in the HTTP v1
 * message). The older `getToken()` is marked deprecated in that SDK, so it is not used. The permission is asked FIRST THING in the press of the button (before any fetch: Safari and iOS drop a request that comes after an await), never on load; the Firebase setup is fetched ahead of time (`preloadPushConfig`). Our own service worker is the one
 * that receives the push (`serviceWorkerRegistration`), so there is no second `firebase-messaging-sw.js`.
 *
 * The id is kept in `localStorage` only as a convenience (to refresh it on every open and to know «هالجهاز»): the page works without it, and every read and write is guarded.
 */
import { deviceLabel, platformOf, pushState, type PushFacts, type PushState } from "@/core/push-env";
import { callJson } from "./call";

const ID_KEY = "mb:push:id";
const FID_KEY = "mb:push:fid";

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // private window or blocked storage: the page still works
  }
};

/** The id of this phone's row on the server, when it registered from here. */
export const thisDeviceId = (): string | null => read(ID_KEY);

/** What the browser can do about push right now. */
export function browserFacts(): PushFacts {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: navigator.userAgent,
    standalone: nav.standalone === true || (typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches),
    hasNotification: typeof Notification !== "undefined",
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: typeof window !== "undefined" && "PushManager" in window,
    permission: typeof Notification !== "undefined" ? Notification.permission : null,
  };
}

export const currentPushState = (): PushState => pushState(browserFacts());

export type EnableResult = { ok: true; deviceId: string } | { ok: false; reason: "setup_needed" | "ios_install" | "unsupported" | "denied" | "dismissed" | "failed"; sentence: string };

const SENTENCE: Record<Extract<EnableResult, { ok: false }>["reason"], string> = {
  setup_needed: "لازم تربط Firebase من «الإعدادات ← الربط» أول.",
  ios_install: "على الآيفون لازم تضيف الموقع للشاشة الرئيسية أول.",
  unsupported: "هالمتصفح ما بيدعم إشعارات الجوال.",
  dismissed: "ما جاوبت على طلب الإذن — اضغط الزر كمان مرة ووافق.",
  denied: "انرفض الإذن — بتقدر ترجّعه من إعدادات المتصفح لهالموقع.",
  failed: "ما قدرنا نفعّل الإشعارات — جرّب كمان مرة.",
};
const fail = (reason: Extract<EnableResult, { ok: false }>["reason"]): EnableResult => ({ ok: false, reason, sentence: SENTENCE[reason] });

interface Config {
  configured: boolean;
  web: { apiKey: string; projectId: string; messagingSenderId: string; appId: string; vapidKey: string } | null;
}

/** Our own service worker: the one the site already registers (so the push lands in `public/sw.js`). */
async function workerRegistration(): Promise<ServiceWorkerRegistration> {
  const have = await navigator.serviceWorker.getRegistration("/");
  if (have) return navigator.serviceWorker.ready;
  await navigator.serviceWorker.register("/sw.js");
  return navigator.serviceWorker.ready;
}

/** The Firebase setup, fetched ahead of the press (the panel calls `preloadPushConfig` when it opens) so the press never has to wait for the network before asking for the permission. */
let cachedConfig: Config | null = null;

export async function preloadPushConfig(): Promise<void> {
  const r = await callJson<Config>("/api/push/config", { cache: "no-store" });
  if (r.ok && r.data) cachedConfig = r.data;
}

/** Drops what was fetched (a sign-out, or a test). */
export const forgetPushConfig = (): void => {
  cachedConfig = null;
};

/** Registers this browser with FCM and tells the server. `ask` = it may ask for the permission (only from a press). `refreshOf` = the automatic renewal of a row this browser remembers. Returns the answer, never throws. */
async function registerHere(ask: boolean, refreshOf?: string): Promise<EnableResult> {
  const state = currentPushState();
  if (state === "ios_install" || state === "unsupported") return fail(state);
  if (state === "denied") return fail("denied");
  // with the setup already known and missing, there is no point in a prompt that leads nowhere
  if (cachedConfig && (!cachedConfig.configured || !cachedConfig.web)) return fail("setup_needed");
  try {
    if (Notification.permission !== "granted") {
      if (!ask) return fail("denied");
      // FIRST, straight inside the press: Safari/iOS refuse (or ignore) a request that comes after an await. «default» = the box was closed without an answer, «denied» = refused.
      const p = await Notification.requestPermission();
      if (p === "default") return fail("dismissed");
      if (p !== "granted") return fail("denied");
    }
    let cfg = cachedConfig;
    if (!cfg) {
      const r = await callJson<Config>("/api/push/config", { cache: "no-store" });
      if (r.ok && r.data) cachedConfig = cfg = r.data;
    }
    if (!cfg?.configured || !cfg.web) return fail("setup_needed");
    const sw = await workerRegistration();
    const [{ initializeApp, getApps, getApp }, messagingMod] = await Promise.all([import("@firebase/app"), import("@firebase/messaging")]);
    const { apiKey, projectId, messagingSenderId, appId, vapidKey } = cfg.web;
    const app = getApps().length ? getApp() : initializeApp({ apiKey, projectId, messagingSenderId, appId });
    if (!(await messagingMod.isSupported())) return fail("unsupported");
    const messaging = messagingMod.getMessaging(app);
    const fid = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timeout")), 20_000);
      const off = messagingMod.onRegistered(messaging, (id) => {
        clearTimeout(timer);
        off();
        resolve(id);
      });
      messagingMod.register(messaging, { vapidKey, serviceWorkerRegistration: sw }).catch((e) => {
        clearTimeout(timer);
        off();
        reject(e);
      });
    });
    const ua = navigator.userAgent;
    const r = await callJson<{ device?: { id: string } }>("/api/push/devices", { method: "POST", body: { token: fid, kind: "fcm_fid", platform: platformOf(ua), label: deviceLabel(ua), ...(refreshOf ? { refreshOf } : {}) } });
    // a renewal for a device that was removed (from here or from another phone) stays removed: forget it, do not bring it back
    if (refreshOf && r.status === 404) {
      write(ID_KEY, null);
      write(FID_KEY, null);
      return fail("failed");
    }
    if (!r.ok || !r.data?.device) return fail("failed");
    write(ID_KEY, r.data.device.id);
    write(FID_KEY, fid);
    return { ok: true, deviceId: r.data.device.id };
  } catch {
    return fail("failed");
  }
}

/** «فعّل الإشعارات على هالجهاز» — call it from the button's press. */
export const enablePush = (): Promise<EnableResult> => registerHere(true);

/** Every open of the site, when the permission is already given: renews the registration and moves `lastSeenAt`. No prompt, no noise on failure. It never brings back a device that was removed («شيله»). */
export async function refreshPush(): Promise<void> {
  const id = read(ID_KEY);
  if (!id || typeof Notification === "undefined" || Notification.permission !== "granted") return;
  await registerHere(false, id);
}

/** «شيل هالجهاز»: the server stops pushing to it, and Firebase forgets it. */
export async function disablePush(): Promise<void> {
  const fid = read(FID_KEY);
  try {
    const [{ getApps, getApp }, messagingMod] = await Promise.all([import("@firebase/app"), import("@firebase/messaging")]);
    if (getApps().length && (await messagingMod.isSupported())) await messagingMod.unregister(messagingMod.getMessaging(getApp()));
  } catch {
    // Firebase forgetting is a courtesy; the server's revoke below is what stops the pushes
  }
  if (fid) await callJson("/api/push/devices", { method: "DELETE", body: { token: fid } });
  write(ID_KEY, null);
  write(FID_KEY, null);
}

/** The number on the icon: how many notices are not read (where the browser can show one). */
export function setBadge(unread: number): void {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  const n = Math.max(0, Math.min(99, Math.floor(unread)));
  try {
    if (n > 0) void nav.setAppBadge?.(n).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch {
    // not supported: the bell still counts
  }
}
