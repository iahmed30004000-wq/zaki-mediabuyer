"use client";

import { useEffect } from "react";

/**
 * Registers the service worker once the page has loaded (production only — the dev server rebuilds too often). The worker's address carries the deploy's version
 * (`/sw.js?v=<version>`), so a new deploy is a new worker that drops the old one's caches (N-15). The same worker receives the phone's notifications.
 */
export function PwaRegister({ version }: { version: string }) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const go = () => navigator.serviceWorker.register(`/sw.js?v=${encodeURIComponent(version)}`).catch(() => undefined);
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, [version]);
  return null;
}
