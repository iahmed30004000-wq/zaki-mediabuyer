/**
 * The owner's awake / asleep switch and the night permissions (v4 · D), on top of the pure rules in src/core/mode.ts.
 * Settings are versioned like every setting, so every flip of the switch is in the history with who made it.
 */
import { DEFAULT_MODE, NightPermissionSchema, OwnerModeSchema, effectiveMode, type NightPermission, type OwnerMode } from "@/core/mode";
import { getSetting, setSetting } from "./settings";

export interface ModeView {
  mode: "awake" | "asleep";
  /** what the switch says (the clock may overrule it when the schedule is on) */
  switch: OwnerMode["mode"];
  since: string | null;
  asleepAt: string | null;
  schedule: OwnerMode["schedule"];
  nightPermissions: NightPermission[];
  wakeKinds: string[];
}

/** Whatever is stored, checked; a broken value is the default (awake) rather than a crash. */
export function readMode(stored: unknown): OwnerMode {
  const p = OwnerModeSchema.safeParse(stored);
  return p.success ? p.data : DEFAULT_MODE;
}

export async function currentMode(now = new Date()): Promise<ModeView> {
  const stored = readMode(await getSetting("owner.mode"));
  const night = ((await getSetting("owner.night_permissions")) as unknown[]).flatMap((n) => {
    const p = NightPermissionSchema.safeParse(n);
    return p.success ? [p.data] : [];
  });
  return { mode: effectiveMode(stored, now), switch: stored.mode, since: stored.since, asleepAt: stored.asleepAt ?? null, schedule: stored.schedule, nightPermissions: night, wakeKinds: (await getSetting("owner.wake_kinds")) as string[] };
}

/** Flips the switch (and/or the schedule). `since` moves only when the switch itself changes. */
export async function setMode(patch: { mode?: OwnerMode["mode"]; schedule?: Partial<OwnerMode["schedule"]> }, by: string | null, now = new Date()): Promise<ModeView> {
  const cur = readMode(await getSetting("owner.mode"));
  const flipped = !!patch.mode && patch.mode !== cur.mode;
  const next: OwnerMode = {
    mode: patch.mode ?? cur.mode,
    since: flipped ? now.toISOString() : cur.since,
    // waking: what was «since» is when he fell asleep; falling asleep starts a new night
    asleepAt: flipped ? (patch.mode === "awake" ? cur.since : null) : cur.asleepAt ?? null,
    schedule: { ...cur.schedule, ...patch.schedule },
  };
  const ok = OwnerModeSchema.parse(next);
  await setSetting("owner.mode", ok, by);
  return currentMode(now);
}

export async function setNightPermissions(list: unknown, by: string | null): Promise<NightPermission[]> {
  const parsed = NightPermissionSchema.array().max(30).parse(list);
  await setSetting("owner.night_permissions", parsed, by);
  return parsed;
}

export async function setWakeKinds(kinds: string[], by: string | null): Promise<string[]> {
  const clean = [...new Set(kinds.map((k) => k.trim()).filter(Boolean))].slice(0, 30);
  await setSetting("owner.wake_kinds", clean, by);
  return clean;
}
