/**
 * CAN THIS BROWSER BE PUSHED TO, and if not, what does the person do about it — pure (docs/rebuild-v6/05-notify.md §6 «آيفون»). The page reads the facts from the browser and this says the state;
 * a button that cannot work is replaced by the steps that make it work.
 *
 *   iPhone: push works only when the site is added to the Home Screen (iOS 16.4 and later) — the page shows three steps instead of a button that does nothing.
 */
export interface PushFacts {
  userAgent: string;
  /** opened from the Home Screen icon (display-mode: standalone, or `navigator.standalone` on an iPhone) */
  standalone: boolean;
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  /** Notification.permission, when there is a Notification */
  permission: "default" | "granted" | "denied" | null;
}

export type PushState =
  /** nothing to do: it can be turned on */
  | "ready"
  /** already allowed on this phone */
  | "granted"
  /** the person said no: only the browser's own settings can undo it */
  | "denied"
  /** an iPhone with the site in Safari: it must be added to the Home Screen first */
  | "ios_install"
  /** this browser has no push at all */
  | "unsupported";

export const isIos = (ua: string): boolean => /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && /Mobile/i.test(ua));

export function pushState(f: PushFacts): PushState {
  // an iPhone browser tab has no push (no PushManager is exposed outside an installed app): the cure is the install, not «unsupported»
  if (isIos(f.userAgent) && !f.standalone) return "ios_install";
  if (!f.hasNotification || !f.hasServiceWorker || !f.hasPushManager) return "unsupported";
  if (f.permission === "denied") return "denied";
  if (f.permission === "granted") return "granted";
  return "ready";
}

/** «أندرويد · Chrome» — a name for the device list, made from the browser's own string (no identifier, nothing about the person). */
export function deviceLabel(ua: string): string {
  const os = /Android/i.test(ua) ? "أندرويد" : isIos(ua) ? "آيفون" : /Windows/i.test(ua) ? "ويندوز" : /Mac OS|Macintosh/i.test(ua) ? "ماك" : /Linux/i.test(ua) ? "لينكس" : "جهاز";
  const browser = /Edg\//i.test(ua) ? "Edge" : /OPR\/|Opera/i.test(ua) ? "Opera" : /Firefox\//i.test(ua) ? "Firefox" : /Chrome\/|CriOS/i.test(ua) ? "Chrome" : /Safari\//i.test(ua) ? "Safari" : "متصفح";
  return `${os} · ${browser}`;
}

export function platformOf(ua: string): "android" | "ios" | "desktop" {
  return /Android/i.test(ua) ? "android" : isIos(ua) ? "ios" : "desktop";
}

/** The three steps for an iPhone (the same ones as the mock-up), in the owner's words. */
export const IOS_STEPS: readonly string[] = ["افتح الموقع بـ Safari (مش من تطبيق تاني).", "اضغط زر المشاركة، وبعدين «إضافة إلى الشاشة الرئيسية».", "افتح الميديا باير من الأيقونة اللي انضافت، وارجع هون وفعّل الإشعارات."];
