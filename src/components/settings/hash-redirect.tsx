"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { settingsFromHash } from "@/lib/settings-nav";

/** An old `/settings#guide` (in an alert, a message, a bookmark) → the page that holds it now. A hash never reaches the server, so the browser does it. */
export function HashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const dest = settingsFromHash(window.location.hash);
    if (dest) router.replace(dest);
  }, [router]);
  return null;
}
