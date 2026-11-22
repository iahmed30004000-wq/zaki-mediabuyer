"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { NAV_COOKIE, type NavMap } from "@/lib/nav";
import { useShell } from "@/components/shell/shell-context";

/**
 * «ترتيب الأماكن» (v6 · P3): the new map (الرئيسية · المهام · الأرقام · الإعلانات) is a trial while the old screens stay; this is the button back to the old order (and forward
 * again). The choice is the cookie `mb_nav` — a plain preference of this browser, nothing the server trusts for permission. It goes away with P8, when the old map does.
 */
export function NavChoice() {
  const router = useRouter();
  const { navMap } = useShell();
  const set = (next: NavMap) => {
    document.cookie = `${NAV_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <section className="space-y-3">
      <h2 className="font-display text-lg font-extrabold text-fg">ترتيب الأماكن</h2>
      <p className="text-base leading-7 text-fg-muted">
        {navMap === "v6"
          ? "الترتيب الجديد: الرئيسية · المهام · الأرقام · الإعلانات. بدك ترجع للترتيب القديم (خمس أماكن)؟ هالزر بيرجّعه، وبتقدر تبدّل كمان مرة."
          : "الترتيب القديم: الرئيسية · بانتظارك · الشغل · الإعلانات · التشغيل. بدك تجرّب الترتيب الجديد؟"}
      </p>
      {navMap === "v6" ? (
        <Button variant="secondary" onClick={() => set("old")}>
          ارجع للترتيب القديم
        </Button>
      ) : (
        <Button variant="secondary" onClick={() => set("v6")}>
          جرّب الترتيب الجديد
        </Button>
      )}
    </section>
  );
}
