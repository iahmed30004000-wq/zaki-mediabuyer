/**
 * What happens to a notice on the way to the phone (docs/rebuild-v6/05-notify.md §4): every kind × (awake · asleep) × (rings · silent · bell) × (a phone · none), the burst, the night's one
 * notice, the retry ladder, the alert → notice mapping, and what the browser can do about push. All pure.
 */
import { describe, expect, it } from "vitest";
import {
  BURST_LIMIT,
  KIND_TABLE,
  MAX_ATTEMPTS,
  NOTIFY_PREFS,
  PUSH_TITLE_MAX,
  RETRY_MINUTES,
  alertNotice,
  badgeCount,
  burstText,
  canonicalKind,
  defaultPref,
  deliveryWord,
  isBurst,
  normalizePrefs,
  planDelivery,
  prefOf,
  pushHref,
  pushText,
  retryAt,
  sleepDigest,
  type NotifyPref,
} from "@/core/notify-plan";
import { IOS_STEPS, deviceLabel, isIos, platformOf, pushState, type PushFacts } from "@/core/push-env";

const NOW = new Date("2026-11-22T10:00:00Z");
const KINDS = KIND_TABLE.map((k) => k.kind);

describe("the table of kinds", () => {
  it("has the kinds of the plan, each with a default and what it does asleep", () => {
    expect(KINDS).toEqual(["approval.new", "run.stuck", "run.missed", "run.failed", "run.done", "stock.red", "report.morning", "backup.failed", "agent.silent"]);
    for (const k of KIND_TABLE) {
      expect(NOTIFY_PREFS).toContain(k.pref);
      expect(["wake", "hold", "pass"]).toContain(k.asleep);
      expect(k.example.length).toBeGreaterThan(3);
    }
  });

  it("defaults follow the plan: a red decision rings, an orange one is silent, a finished job is for the bell, the morning report is silent", () => {
    expect(defaultPref({ kind: "approval.new", urgency: "red" })).toBe("ring");
    expect(defaultPref({ kind: "approval.new", urgency: "orange" })).toBe("silent");
    expect(defaultPref({ kind: "approval.new", urgency: "yellow" })).toBe("site");
    for (const k of ["run.stuck", "run.missed", "run.failed", "run.lost", "backup.failed", "worker.down", "sync.failed"]) expect(defaultPref({ kind: k, urgency: "orange" }), k).toBe("ring");
    expect(defaultPref({ kind: "run.done", urgency: "yellow" })).toBe("site");
    for (const k of ["stock.red", "stock.orange", "report.morning", "agent.silent"]) expect(defaultPref({ kind: k, urgency: "red" }), k).toBe("silent");
  });

  it("a notice with no kind is told by its colour: red rings, orange is silent, yellow stays on the site", () => {
    expect(defaultPref({ kind: null, urgency: "red" })).toBe("ring");
    expect(defaultPref({ kind: null, urgency: "orange" })).toBe("silent");
    expect(defaultPref({ kind: null, urgency: "yellow" })).toBe("site");
    expect(defaultPref({ kind: "something.unknown", urgency: "red" })).toBe("ring");
  });

  it("a notice about the notices themselves is only for the bell (it must not go down the road that failed)", () => {
    expect(defaultPref({ kind: "notify.failed", urgency: "orange" })).toBe("site");
    expect(prefOf({ kind: "notify.failed", urgency: "orange" }, { "notify.failed": "ring" } as never)).toBe("site");
  });

  it("the choice of one kind covers its twins (lost = failed, orange stock = stock)", () => {
    expect(canonicalKind("run.lost")).toBe("run.failed");
    expect(canonicalKind("stock.orange")).toBe("stock.red");
    expect(prefOf({ kind: "run.lost", urgency: "orange" }, { "run.failed": "site" })).toBe("site");
    expect(prefOf({ kind: "stock.orange", urgency: "orange" }, { "stock.red": "ring" })).toBe("ring");
  });

  it("what he chose wins over the default — even for a yellow notice", () => {
    expect(prefOf({ kind: "run.done", urgency: "yellow" }, { "run.done": "silent" })).toBe("silent");
    expect(prefOf({ kind: "run.stuck", urgency: "orange" }, { "run.stuck": "site" })).toBe("site");
  });

  it("stored choices are checked: only known kinds with a known choice survive", () => {
    expect(normalizePrefs({ "run.done": "ring", nonsense: "ring", "run.stuck": "loud", "stock.red": 3 })).toEqual({ "run.done": "ring" });
    expect(normalizePrefs(null)).toEqual({});
    expect(normalizePrefs([])).toEqual({});
    expect(normalizePrefs("x")).toEqual({});
  });
});

describe("planDelivery — every kind × awake / asleep × choice × a phone or none", () => {
  const prefsList: (NotifyPref | null)[] = [null, "ring", "silent", "site"];
  for (const k of KIND_TABLE) {
    for (const mode of ["awake", "asleep"] as const) {
      for (const pref of prefsList) {
        for (const devices of [0, 2]) {
          it(`${k.kind} · ${mode} · ${pref ?? "default"} · ${devices ? "a phone" : "no phone"}`, () => {
            const urgency = k.kind === "approval.new" ? "red" : "orange";
            const p = planDelivery({ kind: k.kind, urgency }, pref ? { [k.kind]: pref } : {}, mode, devices, NOW);
            const eff = pref ?? defaultPref({ kind: k.kind, urgency });
            if (eff === "site") {
              expect(p).toMatchObject({ site: true, hold: false, ring: false, channels: [], why: "site_only" });
            } else if (mode === "asleep" && k.asleep !== "pass") {
              // nothing sounds while he sleeps (no wakeOwner here)
              expect(p).toMatchObject({ hold: true, ring: false, channels: [], why: "held_asleep" });
            } else if (devices === 0) {
              expect(p).toMatchObject({ hold: false, site: false, channels: [], why: "no_channel" });
            } else {
              expect(p).toMatchObject({ hold: false, site: false, channels: ["push"], why: null, ring: eff === "ring" });
            }
          });
        }
      }
    }
  }

  it("asleep: only a red decision of a kind he marked «يصحّيني», whose choice is to ring, rings", () => {
    const base = { kind: "approval.new", urgency: "red", wakeOwner: true };
    expect(planDelivery(base, {}, "asleep", 1, NOW)).toMatchObject({ ring: true, hold: false, channels: ["push"] });
    expect(planDelivery({ ...base, wakeOwner: false }, {}, "asleep", 1, NOW)).toMatchObject({ hold: true });
    expect(planDelivery({ ...base, urgency: "orange" }, {}, "asleep", 1, NOW)).toMatchObject({ hold: true });
    expect(planDelivery(base, { "approval.new": "silent" }, "asleep", 1, NOW)).toMatchObject({ hold: true });
    // a kind that is not a decision never wakes him, whatever the flag says
    expect(planDelivery({ kind: "run.stuck", urgency: "red", wakeOwner: true }, {}, "asleep", 1, NOW)).toMatchObject({ hold: true });
  });

  it("the morning report is silent and harmless: it is not held while he sleeps", () => {
    expect(planDelivery({ kind: "report.morning", urgency: "yellow" }, {}, "asleep", 1, NOW)).toMatchObject({ hold: false, ring: false, channels: ["push"] });
  });

  it("Telegram is the way out when no phone can be reached — and only then, and only if it is linked", () => {
    expect(planDelivery({ kind: "run.stuck", urgency: "orange" }, {}, "awake", 0, NOW, { telegram: true })).toMatchObject({ channels: ["telegram"], why: null });
    expect(planDelivery({ kind: "run.stuck", urgency: "orange" }, {}, "awake", 1, NOW, { telegram: true })).toMatchObject({ channels: ["push", "telegram"] });
    expect(planDelivery({ kind: "run.stuck", urgency: "orange" }, {}, "awake", 0, NOW, { telegram: false })).toMatchObject({ channels: [], why: "no_channel" });
    // «بالموقع بس» means the bell, not Telegram either
    expect(planDelivery({ kind: "run.stuck", urgency: "orange" }, { "run.stuck": "site" }, "awake", 1, NOW, { telegram: true })).toMatchObject({ channels: [], site: true });
  });

  it("the word an agent hears: queued · held_asleep · site_only — never «it rang»", () => {
    expect(deliveryWord(planDelivery({ kind: "run.stuck", urgency: "orange" }, {}, "awake", 1, NOW))).toBe("queued");
    expect(deliveryWord(planDelivery({ kind: "run.stuck", urgency: "orange" }, {}, "asleep", 1, NOW))).toBe("held_asleep");
    expect(deliveryWord(planDelivery({ kind: "run.done", urgency: "yellow" }, {}, "awake", 1, NOW))).toBe("site_only");
    // no phone and no Telegram: the honest answer is the bell, not «queued»
    expect(deliveryWord(planDelivery({ kind: "run.stuck", urgency: "orange" }, {}, "awake", 0, NOW))).toBe("site_only");
  });
});

describe("no spraying", () => {
  it("more than five in ten minutes are one; five or fewer go as they are", () => {
    expect(BURST_LIMIT).toBe(5);
    expect(isBurst(0, 5)).toBe(false);
    expect(isBurst(0, 6)).toBe(true);
    expect(isBurst(3, 3)).toBe(true);
    expect(isBurst(5, 1)).toBe(false); // one notice is never «1 إشعارات جديدة»
    expect(isBurst(2, 3)).toBe(false);
  });
  it("the text of the one notice carries the count", () => {
    expect(burstText(6).title).toBe("6 إشعارات جديدة");
  });
});

describe("the night in one notice", () => {
  it("«وإنت نايم: 2 وقفوا، 1 فاتت» — by count, the decisions first", () => {
    expect(sleepDigest(["run.stuck", "run.failed", "run.missed"]).title).toBe("وإنت نايم: 2 وقفوا، 1 فاتت");
    expect(sleepDigest(["run.missed"]).title).toBe("وإنت نايم: 1 فاتت");
    expect(sleepDigest(["approval.new", "run.stuck"]).title).toBe("وإنت نايم: 1 قرار، 1 وقفت");
    expect(sleepDigest(["approval.new", "approval.new", "run.lost", "backup.failed"]).title).toBe("وإنت نايم: 2 قرارات، 1 وقفت، 1 عطل");
  });
  it("kinds it does not know count as «تنبيه», and a long line falls back to the total (45 characters at most)", () => {
    expect(sleepDigest([null, "x.y"]).title).toBe("وإنت نايم: 2 تنبيهات");
    const long = sleepDigest(["approval.new", "run.stuck", "run.missed", "backup.failed", "stock.red", null, null]);
    expect(long.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
  });
});

describe("retry: a minute · 5 · 15 · an hour, then it stops", () => {
  it("the ladder", () => {
    expect(RETRY_MINUTES).toEqual([1, 5, 15, 60]);
    expect(MAX_ATTEMPTS).toBe(5);
    const at = (n: number) => retryAt(n, NOW)?.getTime();
    expect(at(1)).toBe(NOW.getTime() + 60_000);
    expect(at(2)).toBe(NOW.getTime() + 5 * 60_000);
    expect(at(3)).toBe(NOW.getTime() + 15 * 60_000);
    expect(at(4)).toBe(NOW.getTime() + 60 * 60_000);
    expect(retryAt(5, NOW)).toBeNull();
    expect(retryAt(9, NOW)).toBeNull();
  });
});

describe("the text of a push", () => {
  it("the title is the thing itself in 45 characters; the second line is the reason in 200", () => {
    const t = pushText({ title: "ا".repeat(80), body: "ب".repeat(300) });
    expect(t.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
    expect(t.title.endsWith("…")).toBe(true);
    expect(t.body.length).toBeLessThanOrEqual(200);
    expect(pushText({ title: "  قصير ", body: null })).toEqual({ title: "قصير", body: "" });
  });
  it("a tap only ever lands inside the site", () => {
    expect(pushHref("/inbox/approval%3Aa1")).toBe("/inbox/approval%3Aa1");
    for (const bad of ["https://evil.example/x", "//evil.example", "javascript:alert(1)", "/a\\b", "", null, undefined]) expect(pushHref(bad as string | null | undefined), String(bad)).toBe("/");
  });
  it("the number on the icon is capped", () => {
    expect(badgeCount(0)).toBe(0);
    expect(badgeCount(7.9)).toBe(7);
    expect(badgeCount(400)).toBe(99);
    expect(badgeCount(-3)).toBe(0);
  });
});

describe("an alert of the reading becomes a notice", () => {
  const a = { id: "al1", kind: "alert.backup", tone: "warn", text: "ما في نسخة احتياطية ناجحة من 30 ساعة — شوف «التشغيل»", href: "/ops" };
  it("danger is red, a warning is orange; the key is the alert's own id; the title is short and the sentence is the body", () => {
    expect(alertNotice(a)).toEqual({ urgency: "orange", kind: "backup.failed", title: "النسخة الاحتياطية متأخرة", body: a.text, href: "/ops", key: "alert:al1" });
    expect(alertNotice({ ...a, tone: "danger" }).urgency).toBe("red");
  });
  it("the alerts that are a kind of the table carry it; the others keep their own and are told by their colour", () => {
    expect(alertNotice({ ...a, kind: "alert.stale" }).kind).toBe("sync.failed");
    expect(alertNotice({ ...a, kind: "alert.cpm" }).kind).toBe("alert.cpm");
    expect(defaultPref({ kind: "alert.cpm", urgency: "orange" })).toBe("silent");
  });
  it("an alert with no known title uses the start of its text, in 45 characters", () => {
    const n = alertNotice({ ...a, kind: "alert.new_thing", text: "ن".repeat(120), href: null });
    expect(n.title.length).toBeLessThanOrEqual(PUSH_TITLE_MAX);
    expect(n.href).toBeUndefined();
  });
});

describe("can this browser be pushed to", () => {
  const facts = (over: Partial<PushFacts> = {}): PushFacts => ({ userAgent: "Mozilla/5.0 (Linux; Android 14) Chrome/120.0 Mobile Safari/537.36", standalone: false, hasNotification: true, hasServiceWorker: true, hasPushManager: true, permission: "default", ...over });
  const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";

  it("an Android phone with everything: ready; allowed: granted; refused: denied", () => {
    expect(pushState(facts())).toBe("ready");
    expect(pushState(facts({ permission: "granted" }))).toBe("granted");
    expect(pushState(facts({ permission: "denied" }))).toBe("denied");
  });
  it("an iPhone in Safari gets the three steps, not a button that does nothing; added to the Home Screen it is a normal browser", () => {
    expect(pushState(facts({ userAgent: IPHONE, hasPushManager: false }))).toBe("ios_install");
    expect(pushState(facts({ userAgent: IPHONE, standalone: true }))).toBe("ready");
    expect(IOS_STEPS).toHaveLength(3);
  });
  it("a browser without push says so", () => {
    expect(pushState(facts({ hasPushManager: false }))).toBe("unsupported");
    expect(pushState(facts({ hasServiceWorker: false }))).toBe("unsupported");
    expect(pushState(facts({ hasNotification: false, permission: null }))).toBe("unsupported");
  });
  it("a name for the device list, made from the browser's string only", () => {
    expect(deviceLabel(facts().userAgent)).toBe("أندرويد · Chrome");
    expect(deviceLabel(IPHONE)).toBe("آيفون · Safari");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/121.0")).toBe("ويندوز · Firefox");
    expect(deviceLabel("")).toBe("جهاز · متصفح");
    expect(platformOf(facts().userAgent)).toBe("android");
    expect(platformOf(IPHONE)).toBe("ios");
    expect(platformOf("Mozilla/5.0 (Windows NT 10.0) Chrome/120")).toBe("desktop");
    expect(isIos("Mozilla/5.0 (X11; Linux x86_64)")).toBe(false);
  });
});
