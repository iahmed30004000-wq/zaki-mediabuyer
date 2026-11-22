"use client";

import { useEffect } from "react";
import { refreshPush } from "@/lib/push-client";

/** Every open of the site: a phone that already allowed notifications renews its registration and moves «آخر ظهور». Nothing is asked, nothing is shown. */
export function PushRefresh() {
  useEffect(() => {
    void refreshPush().catch(() => undefined);
  }, []);
  return null;
}
