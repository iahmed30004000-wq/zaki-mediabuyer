/**
 * THE PHONES THAT MAY BE PUSHED TO, and the choices of each person (docs/rebuild-v6/05-notify.md §3 · §6). A device is a row of `PushDevice` tied to the person who proved it
 * with their session; its token is a secret of the device: it is never returned to a screen, never logged and never put in the audit log. «شيله» revokes it (`revokedAt`),
 * nothing is deleted. The choices (ring · silent · site, per kind of notice) are one setting per person: `notify.prefs:<userId>`.
 */
import { z } from "zod";
import { NOTIFY_PREFS, normalizePrefs, type NotifyPref, type PrefsMap } from "@/core/notify-plan";
import { audit } from "./audit";
import { HttpError } from "./auth";
import { db } from "./db";
import { actorOfUser } from "./directory";

export const PLATFORMS = ["android", "ios", "desktop"] as const;
export const DEVICE_KINDS = ["fcm_fid", "fcm"] as const;

export const DeviceInput = z
  .object({
    token: z.string().trim().min(8).max(4096).regex(/^[A-Za-z0-9_\-:.]+$/, "الرمز مش صحيح"),
    kind: z.enum(DEVICE_KINDS).default("fcm_fid"),
    platform: z.enum(PLATFORMS).optional(),
    label: z.string().trim().min(1).max(60).optional(),
    /** the id of the row this browser remembers: set only by the automatic renewal on every open, which never brings a removed device back */
    refreshOf: z.string().trim().min(1).max(64).optional(),
  })
  .strict();
export type DeviceInputT = z.infer<typeof DeviceInput>;

export interface DeviceView {
  id: string;
  label: string;
  platform: string | null;
  lastSeenAt: string | null;
  createdAt: string;
  /** when FCM last refused it (a device that is refused for good is revoked and does not show) */
  failedAt: string | null;
}

const view = (d: { id: string; label: string | null; platform: string | null; lastSeenAt: Date | null; createdAt: Date; failedAt: Date | null }): DeviceView => ({
  id: d.id,
  label: d.label ?? "جهاز",
  platform: d.platform,
  lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
  createdAt: d.createdAt.toISOString(),
  failedAt: d.failedAt?.toISOString() ?? null,
});

/**
 * Registers a browser's token for this person, or refreshes it (the token is unique: a token that moves to another person's session moves with it).
 * A renewal (`refreshOf`, sent by the automatic refresh on every open) only touches a row that is the person's own and not removed: «شيله» sticks, and only the button
 * «فعّل الإشعارات على هالجهاز» (a plain registration) brings a removed device back.
 */
export async function registerDevice(userId: string, input: DeviceInputT, now = new Date()): Promise<{ device: DeviceView; created: boolean }> {
  const found = await db.pushDevice.findUnique({ where: { token: input.token } });
  if (input.refreshOf) return { device: await renewDevice(userId, input, found, now), created: false };
  const data = { userId, kind: input.kind, platform: input.platform ?? found?.platform ?? null, label: input.label ?? found?.label ?? "جهاز", lastSeenAt: now, revokedAt: null, failedAt: null };
  const row = found ? await db.pushDevice.update({ where: { id: found.id }, data }) : await db.pushDevice.create({ data: { token: input.token, ...data } });
  // the name and the kind, never the token (the log redacts a key that says «token» anyway)
  if (!found || found.revokedAt || found.userId !== userId) await audit({ type: "user", id: userId }, "push.device_register", { type: "push_device", id: row.id }, { after: { platform: row.platform, kind: row.kind } });
  return { device: view(row), created: !found };
}

type DeviceRow = NonNullable<Awaited<ReturnType<typeof db.pushDevice.findUnique>>>;

/** The automatic renewal: moves `lastSeenAt` of the person's own, still-active row (and follows a rotated Installation ID). Anything else is «مش موجود» — it never revives a removed device. */
async function renewDevice(userId: string, input: DeviceInputT, found: DeviceRow | null, now: Date): Promise<DeviceView> {
  const mine = await db.pushDevice.findUnique({ where: { id: input.refreshOf! } });
  if (!mine || mine.userId !== userId || mine.revokedAt) throw new HttpError(404, "الجهاز مش موجود");
  // the Installation ID is already another row: only an active row of the same person may take the renewal, never a removed one or somebody else's
  const target = found && found.id !== mine.id ? found : mine;
  if (target.id !== mine.id && (target.userId !== userId || target.revokedAt)) throw new HttpError(404, "الجهاز مش موجود");
  const data = target.id === mine.id ? { token: input.token, lastSeenAt: now, failedAt: null } : { lastSeenAt: now, failedAt: null };
  return view(await db.pushDevice.update({ where: { id: target.id }, data }));
}

/** The person's own devices that still work, newest first. */
export async function listDevices(userId: string): Promise<DeviceView[]> {
  const rows = await db.pushDevice.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: "desc" } });
  return rows.map(view);
}

/** «شيله»: the person's own device only. Another person's id is «مش موجود», not «ممنوع» — it does not say that it exists. */
export async function removeDevice(userId: string, id: string, now = new Date()): Promise<void> {
  const r = await db.pushDevice.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: now } });
  if (!r.count) throw new HttpError(404, "الجهاز مش موجود");
  await audit({ type: "user", id: userId }, "push.device_remove", { type: "push_device", id });
}

/** This browser stopped pushes by itself (the user turned them off on the phone, or signed out): by its token, the person's own only. */
export async function removeDeviceByToken(userId: string, token: string, now = new Date()): Promise<number> {
  const r = await db.pushDevice.updateMany({ where: { token, userId, revokedAt: null }, data: { revokedAt: now } });
  return r.count;
}

/** A device FCM refused for good: it stops being pushed to. */
export async function markDeviceInvalid(id: string, now = new Date()): Promise<void> {
  await db.pushDevice.updateMany({ where: { id }, data: { revokedAt: now, failedAt: now } });
}

export interface ActiveDevice {
  id: string;
  kind: string;
  token: string;
}

export async function activeDevices(userId: string): Promise<ActiveDevice[]> {
  const rows = await db.pushDevice.findMany({ where: { userId, revokedAt: null }, orderBy: { createdAt: "asc" } });
  return rows.map((d) => ({ id: d.id, kind: d.kind, token: d.token }));
}

/** The people a notice for `audience` is for: «owner» is the owner and the manager; anybody else is the person whose directory entry has that key and a linked account. */
export async function recipientsOf(audience: string): Promise<string[]> {
  if (audience === "owner") {
    const users = await db.user.findMany({ where: { role: { in: ["OWNER", "MANAGER"] }, active: true }, select: { id: true } });
    return users.map((u) => u.id);
  }
  const actor = await db.actor.findUnique({ where: { key: audience }, select: { userId: true, active: true } });
  return actor?.userId && actor.active ? [actor.userId] : [];
}

/** The audience of a signed-in person (the same rule the bell uses): the owner's for the owner and the manager, else their directory key. */
export async function audienceOfUser(user: { id: string; role: string }): Promise<string | null> {
  if (user.role === "OWNER" || user.role === "MANAGER") return "owner";
  const me = await actorOfUser(user.id);
  return me?.key ?? null;
}

// ─── the choices ───

const prefsKey = (userId: string) => `notify.prefs:${userId}`;

export async function getPrefs(userId: string): Promise<PrefsMap> {
  const row = await db.setting.findUnique({ where: { key: prefsKey(userId) } });
  return normalizePrefs(row?.value);
}

export const PrefsPatch = z.record(z.string().min(1).max(40), z.enum(NOTIFY_PREFS as unknown as [NotifyPref, ...NotifyPref[]])).refine((o) => Object.keys(o).length <= 30, "كتير");

/** Saves some of the person's choices (the rest stay). Unknown kinds are dropped, so nothing outside the list is ever stored. */
export async function setPrefs(userId: string, patch: unknown): Promise<PrefsMap> {
  const parsed = PrefsPatch.safeParse(patch);
  if (!parsed.success) throw new HttpError(400, "الاختيار مش مفهوم");
  const next = normalizePrefs({ ...(await getPrefs(userId)), ...parsed.data });
  const key = prefsKey(userId);
  const old = await db.setting.findUnique({ where: { key } });
  const version = (old?.version ?? 0) + 1;
  await db.setting.upsert({ where: { key }, create: { key, value: next, version, updatedBy: userId }, update: { value: next, version, updatedBy: userId } });
  await audit({ type: "user", id: userId }, "notify.prefs", { type: "setting", id: key }, { after: next });
  return next;
}
