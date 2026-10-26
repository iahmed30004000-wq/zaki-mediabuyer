"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ArtSlot } from "@/components/theme/art-slot";
import "./mission.css";

/**
 * «تمّت المهمة» — a short banner across the screen after something real got done (an approval, a rollback,
 * a launch). Big, warm, gone in under two seconds, never blocks a click. A nod to the night-city games, in our
 * own words and type. Reduced motion: it simply appears and disappears.
 */
interface Mission {
  title: string;
  detail?: string;
  /** An art slot shown above the title (e.g. "launch-done"); hides itself while the file is missing. */
  art?: string;
}

const Ctx = createContext<(m: Mission) => void>(() => {});

export function MissionProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<(Mission & { key: number }) | null>(null);
  const show = useCallback((m: Mission) => setCurrent({ ...m, key: Date.now() }), []);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), 1900);
    return () => clearTimeout(t);
  }, [current]);

  return (
    <Ctx.Provider value={show}>
      {children}
      {current ? (
        <div key={current.key} role="status" aria-live="polite" className="mb-mission pointer-events-none fixed inset-x-0 top-1/3 z-[60] flex justify-center px-4">
          <div className="mb-mission-band w-full max-w-xl py-4 text-center">
            {current.art ? <ArtSlot slot={current.art} className="mx-auto mb-2 max-h-24 w-auto rounded-xl" /> : null}
            <p className="mb-mission-title font-display text-3xl font-bold text-accent sm:text-4xl">{current.title}</p>
            {current.detail ? <p className="mt-1 text-sm text-fg">{current.detail}</p> : null}
          </div>
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export function useMission() {
  return useContext(Ctx);
}
