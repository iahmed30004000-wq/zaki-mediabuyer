/**
 * THE ONE SENDER (src/jobs/notify-dispatch.ts) on the in-memory stand-in for the database: «sent» means sent, a failure is kept and retried on the ladder, nothing is lost while Firebase is not
 * set up, what would sound waits while he sleeps and comes as one notice, more than five in ten minutes are one, two workers never send the same notice, customer data is never pushed, and
 * a decision already answered is not pushed at all. Firebase and Telegram are pretend servers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { exportPKCS8, generateKeyPair } from "jose";
import { MAX_ATTEMPTS } from "@/core/notify-plan";

const h = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof import("./helpers/fake-db").makeFakeDb> }));
vi.mock("@/server/db", async () => {
  const { makeFakeDb, addUsers } = await import("./helpers/fake-db");
  h.db = addUsers(makeFakeDb());
  return { db: h.db };
});
vi.mock("@/server/audit", () => ({ audit: async () => undefined }));

import { resetFcmTokenCache, type FcmConfig } from "@/adapters/fcm";
import { HELD, NO_CHANNEL, dispatchDue, dispatchOne, sendTestPush } from "@/jobs/notify-dispatch";
import { queueAlerts } from "@/jobs/alerts";
import { createNotification } from "@/server/notify";

type Rows = Record<string, any>[];
const rows = (name: string): Rows => (h.db as unknown as Record<string, { rows: Rows }>)[name]!.rows;
const NOW = new Date("2026-11-22T10:00:00.000Z");
const min = (m: number) => new Date(NOW.getTime() + m * 60_000);

let privateKey = "";
beforeAll(async () => {
  privateKey = await exportPKCS8((await generateKeyPair("RS256", { extractable: true })).privateKey);
});
afterAll(() => resetFcmTokenCache());

/** A pretend Firebase: `answer(deviceToken)` decides each send; every send is recorded. */
function firebase(answer: (token: string) => { status: number; word?: string; text?: string } = () => ({ status: 200 })) {
  const sends: { token: string; message: Record<string, any> }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    if (url.includes("oauth2")) return new Response(JSON.stringify({ access_token: "ya29.test-access", expires_in: 3600 }), { status: 200 });
    const message = JSON.parse(String(init.body)).message as Record<string, any>;
    const token = message.fid ?? message.token;
    sends.push({ token, message });
    const a = answer(token);
    if (a.status === 200) return new Response(JSON.stringify({ name: "projects/p/messages/1" }), { status: 200 });
    return new Response(JSON.stringify({ error: { status: a.word ?? "UNAVAILABLE", message: a.text ?? "x" } }), { status: a.status });
  }) as unknown as typeof fetch;
  const cfg: FcmConfig = { projectId: "p", account: { client_email: "svc@p.iam.gserviceaccount.com", private_key: privateKey }, fetch: fetchImpl };
  return { sends, cfg };
}

function telegram() {
  const sent: string[] = [];
  const fetchImpl = (async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)).text);
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  return { sent, opts: { token: "tg-token-test", chatId: "owner-chat", fetch: fetchImpl } };
}

const ORIGIN = "https://mb.example.test";
const seed = () => {
  rows("user").push({ id: "u-owner", email: "o@x.test", role: "OWNER", active: true });
  rows("user").push({ id: "u-mgr", email: "m@x.test", role: "MANAGER", active: true });
  rows("user").push({ id: "u-member", email: "t@x.test", role: "MEMBER", active: true });
};
const device = (userId: string, token: string, over: Record<string, unknown> = {}) => rows("pushDevice").push({ id: `d-${token}`, userId, token, kind: "fcm_fid", revokedAt: null, ...over });
const notice = (over: Record<string, unknown> = {}) =>
  createNotification({ urgency: "orange", audience: "owner", kind: "run.stuck", title: "جولة الليل واقفة", body: "بانتظار حدا من 30 دقيقة. اضغط تشوف.", href: "/work/job/night", key: `k${Math.random()}`, ...over } as never);
const mode = (m: "awake" | "asleep") => rows("setting").push({ key: "owner.mode", value: { mode: m, since: null, schedule: { enabled: false, awake: "10:00", asleep: "02:00" } }, version: 1 });
const row = (id: string) => rows("notification").find((r) => r.id === id)!;

beforeEach(() => {
  resetFcmTokenCache();
  for (const t of Object.values(h.db)) if (t && typeof t === "object" && "rows" in t) (t as { rows: unknown[] }).rows.length = 0;
  seed();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("Firebase is not set up yet (no key, no phone): nothing is invented, nothing is lost", () => {
  it("a red notice stays in the bell, honestly unsent: no sentAt, no failure counted, the reason is «no_channel»; the tool hears «site_only»", async () => {
    const n = await notice({ urgency: "red", kind: "approval.new", key: undefined });
    const d = await dispatchOne(n.id, NOW, { fcm: null, telegram: null, origin: ORIGIN });
    expect(d).toMatchObject({ delivered: false, delivery: "site_only" });
    expect(row(n.id)).toMatchObject({ sentAt: null, attempts: 0, lastError: NO_CHANNEL, channels: [] });
    expect(row(n.id).nextTryAt.getTime()).toBe(min(15).getTime());
  });

  it("the clock does not burn the notice: every pass leaves it for the day the setup is done", async () => {
    const n = await notice();
    for (let i = 0; i < 4; i++) await dispatchDue(min(i * 20), { fcm: null, telegram: null, origin: ORIGIN });
    expect(row(n.id)).toMatchObject({ sentAt: null, attempts: 0, lastError: NO_CHANNEL });
  });

  it("the day Firebase and a phone are there, a fresh one goes out; one older than a day never does", async () => {
    const fresh = await notice();
    const stale = await notice();
    row(stale.id).createdAt = new Date(NOW.getTime() - 25 * 3_600_000);
    await dispatchDue(NOW, { fcm: null, telegram: null, origin: ORIGIN });
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    const stats = await dispatchDue(min(16), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(stats.sent).toBe(1);
    expect(row(fresh.id).sentAt).not.toBeNull();
    expect(row(stale.id).sentAt).toBeNull();
    expect(f.sends).toHaveLength(1);
  });

  it("Telegram, when it is linked, is the way out while no phone can be reached", async () => {
    const tg = telegram();
    const n = await notice();
    const d = await dispatchOne(n.id, NOW, { fcm: null, telegram: tg.opts, origin: ORIGIN });
    expect(d).toMatchObject({ delivered: true, via: "telegram", delivery: "queued" });
    expect(row(n.id)).toMatchObject({ channels: ["telegram"], lastError: null });
    expect(row(n.id).sentAt).not.toBeNull();
    expect(tg.sent[0]).toContain("جولة الليل واقفة");
    expect(tg.sent[0]).toContain(`${ORIGIN}/work/job/night`);
  });
});

describe("a phone", () => {
  it("a red decision rings: Urgency high, it stays on the screen; sentAt and the channel are written only after Firebase took it", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    const n = await notice({ urgency: "red", kind: "approval.new", title: "بدّها قرارك: تكبير «حرير 3» +20%", href: "/inbox/approval%3Aa1", key: undefined });
    const d = await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(d).toMatchObject({ delivered: true, via: "push", delivery: "queued" });
    expect(f.sends).toHaveLength(1);
    const m = f.sends[0]!.message;
    expect(m.webpush.headers.Urgency).toBe("high");
    expect(m.webpush.notification.requireInteraction).toBe(true);
    expect(m.data.href).toBe("/inbox/approval%3Aa1");
    expect(row(n.id)).toMatchObject({ ring: true, channels: ["push"], lastError: null, nextTryAt: null });
    expect(row(n.id).sentAt).toEqual(NOW);
  });

  it("low stock is silent (no sound, not kept on the screen); the manager's phone gets it too (the owner's audience is both)", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    device("u-mgr", "phone-B-installation-id");
    device("u-member", "phone-C-installation-id");
    const n = await notice({ kind: "stock.red", title: "«كمأة» بتكفي 5 أيام" });
    await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends.map((s) => s.token).sort()).toEqual(["phone-A-installation-id", "phone-B-installation-id"]);
    expect(f.sends[0]!.message.webpush.notification.silent).toBe(true);
    expect(row(n.id).ring).toBe(false);
  });

  it("a yellow one (and «مهمة خلصت») is for the bell: it is closed on the site, nothing is pushed", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    const n = await notice({ urgency: "yellow", kind: "run.done", title: "جولة الليل خلصت" });
    const d = await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(d).toMatchObject({ delivered: false, delivery: "site_only" });
    expect(f.sends).toHaveLength(0);
    expect(row(n.id)).toMatchObject({ channels: ["site"], ring: false });
    expect(row(n.id).sentAt).toEqual(NOW);
  });

  it("his own choice wins: «بالموقع بس» for stuck jobs keeps it off the phone", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    rows("setting").push({ key: "notify.prefs:u-owner", value: { "run.stuck": "site" }, version: 1 });
    rows("setting").push({ key: "notify.prefs:u-mgr", value: { "run.stuck": "site" }, version: 1 });
    const n = await notice();
    await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(0);
    expect(row(n.id).channels).toEqual(["site"]);
  });

  it("a team member's notice goes to the member's own phone, not the owner's", async () => {
    rows("actor").push({ key: "abdullah", name: "عبدالله", kind: "person", userId: "u-member", active: true, telegram: null });
    const f = firebase();
    device("u-owner", "owner-phone-installation");
    device("u-member", "member-phone-installation");
    const n = await notice({ audience: "abdullah", kind: "run.missed", title: "مهمتك فاتت" });
    await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends.map((s) => s.token)).toEqual(["member-phone-installation"]);
  });
});

describe("a failure is kept and retried on the ladder; the end is said in the bell", () => {
  it("503 → attempts 1, the reason kept, the next try in a minute; «انبعت» is not written", async () => {
    const f = firebase(() => ({ status: 503, word: "UNAVAILABLE" }));
    device("u-owner", "phone-A-installation-id");
    const n = await notice();
    const d = await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(d.delivered).toBe(false);
    expect(row(n.id)).toMatchObject({ sentAt: null, attempts: 1, lastError: "unavailable" });
    expect(row(n.id).nextTryAt.getTime()).toBe(min(1).getTime());
  });

  it("not before its time; then 5, 15, 60 minutes; the fifth failure closes it and the bell gets «ما قدرنا نبعتلك»", async () => {
    const f = firebase(() => ({ status: 503, word: "UNAVAILABLE" }));
    const deps = { fcm: f.cfg, telegram: null, origin: ORIGIN };
    device("u-owner", "phone-A-installation-id");
    const n = await notice();
    let t = 0;
    await dispatchDue(min(t), deps);
    expect(row(n.id).attempts).toBe(1);
    await dispatchDue(min(t + 0.5), deps);
    expect(row(n.id).attempts).toBe(1); // not due yet
    const waits = [1, 5, 15, 60];
    for (const [i, w] of waits.entries()) {
      t += w;
      await dispatchDue(min(t), deps);
      expect(row(n.id).attempts, `after ${w} min`).toBe(i + 2 > 4 ? MAX_ATTEMPTS : i + 2);
    }
    expect(row(n.id).attempts).toBe(MAX_ATTEMPTS);
    expect(row(n.id).sentAt).toBeNull();
    const sendsBefore = f.sends.length;
    await dispatchDue(min(t + 600), deps);
    expect(f.sends.length).toBe(sendsBefore); // stopped
    const told = rows("notification").find((r) => r.key === `notify.failed:${n.id}`)!;
    expect(told).toMatchObject({ kind: "notify.failed", title: "ما قدرنا نبعتلك إشعار", audience: "owner" });
    expect(told.sentAt).not.toBeNull(); // itself a bell-only notice: never pushed down the road that failed
    expect(told.channels).toEqual(["site"]);
  });

  it("a push that fails falls back to Telegram in the same try when it is linked", async () => {
    const f = firebase(() => ({ status: 503 }));
    const tg = telegram();
    device("u-owner", "phone-A-installation-id");
    const n = await notice();
    await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: tg.opts, origin: ORIGIN });
    expect(row(n.id)).toMatchObject({ channels: ["telegram"], attempts: 0 });
    expect(row(n.id).sentAt).not.toBeNull();
  });

  it("FCM says the token is gone (404): the device is revoked, never pushed to again, and with nowhere else to go the notice waits honestly", async () => {
    const f = firebase(() => ({ status: 404, word: "NOT_FOUND" }));
    device("u-owner", "phone-A-installation-id");
    const n = await notice();
    await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    const dev = rows("pushDevice")[0]!;
    expect(dev.revokedAt).toEqual(NOW);
    expect(dev.failedAt).toEqual(NOW);
    expect(row(n.id)).toMatchObject({ sentAt: null, attempts: 0, lastError: NO_CHANNEL });
    await dispatchDue(min(16), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(1); // the revoked phone is not asked again
  });
});

describe("asleep: what would sound waits, and comes as one notice", () => {
  it("orange and ordinary red notices are held (the word is «held_asleep»); a red decision of a kind he marked «يصحّيني» rings", async () => {
    mode("asleep");
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    const stuck = await notice({ kind: "run.stuck" });
    const dec = await notice({ urgency: "red", kind: "approval.new", key: "approval:wake1", title: "بدّها قرارك: رفع السقف" });
    const plain = await notice({ urgency: "red", kind: "approval.new", key: "approval:plain1", title: "بدّها قرارك: شي تاني" });
    rows("approval").push({ id: "wake1", status: "pending", wakeOwner: true });
    rows("approval").push({ id: "plain1", status: "pending", wakeOwner: false });
    const d1 = await dispatchOne(stuck.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(d1).toMatchObject({ delivered: false, delivery: "held_asleep" });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]!.message.notification.title).toContain("رفع السقف");
    expect(f.sends[0]!.message.webpush.headers.Urgency).toBe("high");
    expect(row(dec.id).sentAt).not.toBeNull();
    expect(row(stuck.id)).toMatchObject({ sentAt: null, lastError: HELD });
    expect(row(plain.id)).toMatchObject({ sentAt: null, lastError: HELD });
  });

  it("held notices are not retried or counted as failures while he sleeps, and one «وإنت نايم: 2 وقفوا، 1 فاتت» goes when he wakes", async () => {
    mode("asleep");
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    await notice({ kind: "run.stuck", key: "a" });
    await notice({ kind: "run.failed", key: "b" });
    await notice({ kind: "run.missed", key: "c" });
    for (let i = 0; i < 3; i++) await dispatchDue(min(i * 60), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(0);
    expect(rows("notification").every((r) => r.attempts === 0 && r.lastError === HELD)).toBe(true);
    // he wakes
    rows("setting").length = 0;
    mode("awake");
    await dispatchDue(min(200), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]!.message.notification.title).toBe("وإنت نايم: 2 وقفوا، 1 فاتت");
    expect(f.sends[0]!.message.webpush.notification.silent).toBe(true);
    expect(rows("notification").every((r) => r.sentAt !== null && r.channels.includes("push"))).toBe(true);
  });

  it("a held notice that was answered or withdrawn meanwhile is not sent when he wakes (a decision he already made)", async () => {
    mode("asleep");
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    rows("approval").push({ id: "ap1", status: "pending", wakeOwner: false });
    const n = await notice({ urgency: "orange", kind: "approval.new", key: "approval:ap1", title: "بدّها قرارك: شي" });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(row(n.id).lastError).toBe(HELD);
    rows("approval")[0]!.status = "approved";
    rows("setting").length = 0;
    mode("awake");
    await dispatchDue(min(30), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(0);
    expect(row(n.id)).toMatchObject({ sentAt: null, attempts: MAX_ATTEMPTS, lastError: "decided" });
  });
});

describe("no spraying", () => {
  it("six notices in one pass are ONE «6 إشعارات جديدة»; five go as they are", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    for (let i = 0; i < 6; i++) await notice({ key: `s${i}`, title: `إشعار ${i}` });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]!.message.notification.title).toBe("6 إشعارات جديدة");
    expect(rows("notification").every((r) => r.sentAt !== null)).toBe(true);

    rows("notification").length = 0;
    const g = firebase();
    for (let i = 0; i < 5; i++) await notice({ key: `t${i}`, title: `إشعار ${i}` });
    await dispatchDue(min(60), { fcm: g.cfg, telegram: null, origin: ORIGIN });
    expect(g.sends).toHaveLength(5);
  });

  it("what already went in the last ten minutes counts", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    for (let i = 0; i < 3; i++) rows("notification").push({ id: `old${i}`, audience: "owner", sentAt: min(-3), channels: ["push"], urgency: "orange", title: "x", key: `old${i}`, createdAt: min(-4), attempts: 0, nextTryAt: null });
    for (let i = 0; i < 3; i++) await notice({ key: `n${i}` });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]!.message.notification.title).toBe("3 إشعارات جديدة");
  });

  it("the same notice twice is one (its key), so it is pushed once", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    const a = await notice({ key: "same" });
    const b = await notice({ key: "same" });
    expect(b).toMatchObject({ id: a.id, created: false });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    await dispatchDue(min(1), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(1);
  });
});

describe("two workers never send the same notice", () => {
  it("two passes at once: one push per notice", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    for (let i = 0; i < 3; i++) await notice({ key: `w${i}` });
    const deps = { fcm: f.cfg, telegram: null, origin: ORIGIN };
    await Promise.all([dispatchDue(NOW, deps), dispatchDue(NOW, deps)]);
    expect(f.sends).toHaveLength(3);
  });
});

describe("what never goes to a phone", () => {
  it("customer data: a notice with a phone number or an e-mail in it is closed in the bell and never pushed", async () => {
    const f = firebase();
    const tg = telegram();
    device("u-owner", "phone-A-installation-id");
    const a = await notice({ key: "p1", title: "العميل 0791234567 ما ردّ" });
    const b = await notice({ key: "p2", body: "راسله على someone@example.com" });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: tg.opts, origin: ORIGIN });
    expect(f.sends).toHaveLength(0);
    expect(tg.sent).toHaveLength(0);
    for (const n of [a, b]) expect(row(n.id)).toMatchObject({ sentAt: null, attempts: MAX_ATTEMPTS, lastError: "private_data" });
  });

  it("a decision that was answered before it went out is not pushed", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    rows("approval").push({ id: "ap9", status: "rejected", wakeOwner: false });
    const n = await notice({ urgency: "red", kind: "approval.new", key: "approval:ap9" });
    await dispatchDue(NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(f.sends).toHaveLength(0);
    expect(row(n.id).lastError).toBe("decided");
  });

  it("the push carries the notice's own title and reason in 45 and 200 characters — and no token, key or id of a customer", async () => {
    const f = firebase();
    device("u-owner", "phone-A-installation-id");
    const n = await notice({ key: "long", title: "ع".repeat(120), body: "س".repeat(400) });
    await dispatchOne(n.id, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN });
    const m = f.sends[0]!.message;
    expect(m.notification.title.length).toBeLessThanOrEqual(45);
    expect(m.notification.body.length).toBeLessThanOrEqual(200);
    expect(Object.keys(m.data).sort()).toEqual(["href", "id", "kind"]);
  });
});

describe("the alerts of the reading are written as notices, and an alert is «sent» only when a channel took its notice", () => {
  it("one alert, one notice, however many times it runs; danger is red, a warning is orange; info alerts stay on the site", async () => {
    rows("alert").push({ id: "al1", kind: "alert.backup", tone: "warn", text: "ما في نسخة احتياطية ناجحة من 30 ساعة", href: "/ops", sentAt: null, createdAt: NOW });
    rows("alert").push({ id: "al2", kind: "alert.token", tone: "danger", text: "توكن ميتا انتهى", href: "/settings/connections", sentAt: null, createdAt: NOW });
    rows("alert").push({ id: "al3", kind: "alert.info", tone: "info", text: "معلومة", href: null, sentAt: null, createdAt: NOW });
    expect(await queueAlerts(NOW)).toEqual({ alerts: 2, written: 2 });
    expect(await queueAlerts(NOW)).toEqual({ alerts: 2, written: 0 });
    const keys = rows("notification").map((r) => r.key).sort();
    expect(keys).toEqual(["alert:al1", "alert:al2"]);
    expect(rows("notification").find((r) => r.key === "alert:al2")).toMatchObject({ urgency: "red", kind: "alert.token" });
    expect(rows("notification").find((r) => r.key === "alert:al1")).toMatchObject({ urgency: "orange", kind: "backup.failed", title: "النسخة الاحتياطية متأخرة" });
    // nothing is linked: the alerts are not marked sent (the bell has them)
    await dispatchDue(NOW, { fcm: null, telegram: null, origin: ORIGIN });
    expect(rows("alert").every((a) => a.sentAt === null)).toBe(true);
    // a phone appears: now they are
    device("u-owner", "phone-A-installation-id");
    const f = firebase();
    await dispatchDue(min(16), { fcm: f.cfg, telegram: null, origin: ORIGIN });
    expect(rows("alert").filter((a) => a.sentAt !== null).map((a) => a.id).sort()).toEqual(["al1", "al2"]);
  });
});

describe("«جرّب» — a test to the person's own phones", () => {
  it("not set up → «setup_needed»; no phone → «no_device»; a phone that took it → ok with the count; nothing is written to the bell", async () => {
    expect(await sendTestPush("u-owner", {}, NOW, { fcm: null, telegram: null, origin: ORIGIN })).toEqual({ ok: false, sent: 0, failed: 0, reason: "setup_needed" });
    const f = firebase();
    expect(await sendTestPush("u-owner", {}, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN })).toEqual({ ok: false, sent: 0, failed: 0, reason: "no_device" });
    device("u-owner", "phone-A-installation-id");
    device("u-mgr", "phone-B-installation-id");
    expect(await sendTestPush("u-owner", { ring: true }, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN })).toEqual({ ok: true, sent: 1, failed: 0, reason: null });
    expect(f.sends).toHaveLength(1);
    expect(f.sends[0]!.token).toBe("phone-A-installation-id"); // only the person's own
    expect(f.sends[0]!.message.webpush.headers.Urgency).toBe("high");
    expect(rows("notification")).toHaveLength(0);
  });

  it("a phone Firebase refused is not «sent»: it says so, and the dead phone is dropped", async () => {
    const f = firebase(() => ({ status: 404, word: "NOT_FOUND" }));
    device("u-owner", "phone-A-installation-id");
    expect(await sendTestPush("u-owner", {}, NOW, { fcm: f.cfg, telegram: null, origin: ORIGIN })).toEqual({ ok: false, sent: 0, failed: 1, reason: "refused" });
    expect(rows("pushDevice")[0]!.revokedAt).toEqual(NOW);
  });
});
