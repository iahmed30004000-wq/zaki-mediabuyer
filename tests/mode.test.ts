import { describe, expect, it } from "vitest";
import { DEFAULT_MODE, NightPermissionSchema, OwnerModeSchema, ammanHM, deliveryFor, effectiveMode, inAwakeWindow, mayRun, type OwnerMode } from "@/core/mode";

describe("the Amman clock", () => {
  it("reads HH:MM on Amman time (UTC+3)", () => {
    expect(ammanHM(new Date("2026-11-14T07:43:00Z"))).toBe("10:43");
    expect(ammanHM(new Date("2026-11-14T21:05:00Z"))).toBe("00:05");
    expect(ammanHM(new Date("2026-11-14T20:59:00Z"))).toBe("23:59");
  });
});

describe("the awake window", () => {
  it("is inside [awake, asleep) when it does not cross midnight", () => {
    expect(inAwakeWindow("09:59", "10:00", "22:00")).toBe(false);
    expect(inAwakeWindow("10:00", "10:00", "22:00")).toBe(true);
    expect(inAwakeWindow("21:59", "10:00", "22:00")).toBe(true);
    expect(inAwakeWindow("22:00", "10:00", "22:00")).toBe(false);
  });
  it("crosses midnight (awake 10:00, asleep 02:00)", () => {
    expect(inAwakeWindow("23:30", "10:00", "02:00")).toBe(true);
    expect(inAwakeWindow("00:35", "10:00", "02:00")).toBe(true);
    expect(inAwakeWindow("02:00", "10:00", "02:00")).toBe(false);
    expect(inAwakeWindow("09:59", "10:00", "02:00")).toBe(false);
  });
});

describe("the effective mode", () => {
  const manual = (mode: OwnerMode["mode"]): OwnerMode => ({ ...DEFAULT_MODE, mode });
  const scheduled: OwnerMode = { mode: "awake", since: null, schedule: { enabled: true, awake: "10:00", asleep: "02:00" } };

  it("is the switch when there is no schedule", () => {
    expect(effectiveMode(manual("asleep"), new Date("2026-11-14T07:43:00Z"))).toBe("asleep");
    expect(effectiveMode(manual("awake"), new Date("2026-11-14T00:00:00Z"))).toBe("awake");
  });
  it("is the clock when the schedule is on, whatever the switch says", () => {
    expect(effectiveMode(scheduled, new Date("2026-11-14T07:43:00Z"))).toBe("awake"); // 10:43
    expect(effectiveMode(scheduled, new Date("2026-11-14T23:30:00Z"))).toBe("asleep"); // 02:30
    expect(effectiveMode({ ...scheduled, mode: "asleep" }, new Date("2026-11-14T07:43:00Z"))).toBe("awake");
  });
  it("is checked: an hour that does not exist is refused", () => {
    expect(OwnerModeSchema.safeParse(DEFAULT_MODE).success).toBe(true);
    expect(OwnerModeSchema.safeParse({ ...DEFAULT_MODE, schedule: { enabled: true, awake: "25:00", asleep: "02:00" } }).success).toBe(false);
    expect(OwnerModeSchema.safeParse({ ...DEFAULT_MODE, mode: "dozing" }).success).toBe(false);
  });
});

describe("what a request does to the phone", () => {
  it("awake: 🔴 rings, 🟠 notifies, 🟡 is silent", () => {
    expect(deliveryFor("red", "awake", false)).toBe("ring");
    expect(deliveryFor("orange", "awake", false)).toBe("notify");
    expect(deliveryFor("yellow", "awake", false)).toBe("silent");
  });
  it("asleep: nothing rings and nothing sounds — it waits for the morning card — unless it is a kind he marked «يصحّيني»", () => {
    expect(deliveryFor("red", "asleep", false)).toBe("queue");
    expect(deliveryFor("orange", "asleep", false)).toBe("queue");
    expect(deliveryFor("orange", "asleep", true)).toBe("queue");
    expect(deliveryFor("red", "asleep", true)).toBe("ring");
  });
  it("🟡 never reaches the phone, awake or not", () => {
    expect(deliveryFor("yellow", "asleep", true)).toBe("silent");
  });
});

describe("what runs while he sleeps", () => {
  const night = [{ key: "night-round", label: "جولة الليل", cap: 120 }, { key: "video-collection", label: "جمع الفيديوهات" }];
  it("lets everything run when he is awake", () => {
    expect(mayRun("anything", "awake", night)).toMatchObject({ ok: true, cap: null });
  });
  it("lets only the whitelisted jobs run when he sleeps, each with its cap", () => {
    expect(mayRun("night-round", "asleep", night)).toMatchObject({ ok: true, cap: 120 });
    expect(mayRun("video-collection", "asleep", night)).toMatchObject({ ok: true, cap: null });
    const r = mayRun("product-tests", "asleep", night);
    expect(r.ok).toBe(false);
    expect(r.why).toContain("نايم");
  });
  it("checks a permission", () => {
    expect(NightPermissionSchema.safeParse({ key: "night-round", label: "x", cap: 50 }).success).toBe(true);
    expect(NightPermissionSchema.safeParse({ key: "", label: "x" }).success).toBe(false);
    expect(NightPermissionSchema.safeParse({ key: "k", label: "x", cap: -1 }).success).toBe(false);
  });
});
