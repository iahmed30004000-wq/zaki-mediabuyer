/**
 * THE REQUESTS ABOUT A VIDEO, the server side (v3 · D). The four buttons of a card — «بدو هوكات جديدة», «بدو سيناريو
 * جديد», «ارفعه للتيست», «تعب» — each make ONE request: a row here, a card on المهام (assigned to Hermes), and a delivery to
 * Hermes (its API, else its chat). The request carries the video's JOB, its scenario file and the numbers the code computed.
 * It then moves طلب ← عند هيرمز ← جاهز ← مرفوع. Hermes can also pull the queue and answer over REST.
 *
 * Nothing here edits a video, spends, or classifies a video for policy (owner rules) — the only thing that ever changes a
 * video is its own flag in the bank («تعب» marks it tired). Nothing is deleted: a cancelled request stays, as cancelled.
 */
import { z } from "zod";
import type { Prisma, VideoRequest } from "@prisma/client";
import { REQUEST_KINDS, REQUEST_KIND_AR, REQUEST_STATUSES, REQUEST_STATUS_AR, buildPayload, canMoveRequest, requestText, requestTitle, taskStatusOf, videoLabel, type RequestKind, type RequestNumbers, type RequestPayload, type RequestStatus } from "@/core/video-board";
import { refuseIfPrivate } from "@/core/push-rows";
import { hermesChatFromEnv, hermesFromEnv, sendToHermesApi, sendToHermesChat } from "@/adapters/hermes";
import { findBoardVideo, numbersOf } from "@/lib/videos-board";
import { audit, type Actor } from "./audit";
import { db } from "./db";
import { HandoffRefused } from "./handoffs";
import { applyVideos } from "./push";
import { createTask, updateTask } from "./tasks";

const json = (v: unknown) => v as Prisma.InputJsonValue;

/** A refusal in words. It is a HandoffRefused so the token wrapper of the REST routes already answers it with the right code. */
export class VideoRequestRefused extends HandoffRefused {}

const text = (n: number) => z.string().trim().min(1).max(n);

export const VideoRequestCreate = z
  .object({
    key: text(160).describe("مفتاح الفيديو (JOB|V أو رمز CR)"),
    kind: z.enum(REQUEST_KINDS).describe("new_hooks · new_script · to_test · tired"),
    note: text(300).optional().describe("سطر للي رح ياخد الطلب (اختياري)"),
  })
  .strict();
export type VideoRequestCreateT = z.infer<typeof VideoRequestCreate>;

const NewVideo = z
  .object({
    job: text(40),
    v_name: text(60),
    drive_file_id: text(120).optional(),
    scenario_file_id: text(120).optional(),
    meta_video_id: text(64).optional(),
    notes: z.string().trim().max(300).optional(),
  })
  .strict();

export const VideoRequestComplete = z
  .object({
    note: text(300).optional().describe("سطر: شو انعمل"),
    result: z.record(z.union([z.string().max(80), z.number().finite()])).refine((o) => Object.keys(o).length <= 20, "حتى 20 رقم").optional().describe("النتيجة {الاسم: القيمة}"),
    new_videos: z.array(NewVideo).max(20).optional().describe("الفيديوهات اللي طلعت من الطلب (هوكات جديدة…): بتنضاف للبنك «جاهز»"),
  })
  .strict();
export type VideoRequestCompleteT = z.infer<typeof VideoRequestComplete>;

export interface VideoRequestView {
  id: string;
  videoKey: string;
  kind: RequestKind;
  kindLabel: string;
  status: RequestStatus;
  statusLabel: string;
  product: string;
  label: string;
  job: string | null;
  vName: string | null;
  crCode: string | null;
  driveFileId: string | null;
  scenarioFileId: string | null;
  numbers: RequestNumbers | Record<string, never>;
  note: string | null;
  via: "api" | "telegram" | "none";
  deliveredAt: string | null;
  deliveryError: string | null;
  claimedBy: string | null;
  result: Record<string, string | number> | null;
  resultNote: string | null;
  readyAt: string | null;
  uploadedAt: string | null;
  taskId: string | null;
  createdAt: string;
}

export const requestView = (r: VideoRequest): VideoRequestView => ({
  id: r.id,
  videoKey: r.videoKey,
  kind: r.kind as RequestKind,
  kindLabel: REQUEST_KIND_AR[r.kind as RequestKind] ?? r.kind,
  status: r.status as RequestStatus,
  statusLabel: REQUEST_STATUS_AR[r.status as RequestStatus] ?? r.status,
  product: r.productCode,
  label: videoLabel(r),
  job: r.job,
  vName: r.vName,
  crCode: r.crCode,
  driveFileId: r.driveFileId,
  scenarioFileId: r.scenarioFileId,
  numbers: (r.numbers as unknown as RequestNumbers) ?? {},
  note: r.note,
  via: r.via === "api" || r.via === "telegram" ? r.via : "none",
  deliveredAt: r.deliveredAt?.toISOString() ?? null,
  deliveryError: r.deliveryError,
  claimedBy: r.claimedBy,
  result: (r.result as VideoRequestView["result"]) ?? null,
  resultNote: r.resultNote,
  readyAt: r.readyAt?.toISOString() ?? null,
  uploadedAt: r.uploadedAt?.toISOString() ?? null,
  taskId: r.taskId,
  createdAt: r.createdAt.toISOString(),
});

const message = (e: unknown) => (e instanceof Error ? e.message : "فشل").replace(/\s+/g, " ").slice(0, 160);

/** The payload as the request row has it now (what is delivered, and what a poll of the queue reads). */
function payloadOf(r: VideoRequest): RequestPayload {
  return buildPayload(
    { id: r.id, kind: r.kind as RequestKind, product: r.productCode, job: r.job, vName: r.vName, crCode: r.crCode, driveFileId: r.driveFileId, scenarioFileId: r.scenarioFileId, numbers: r.numbers as unknown as RequestNumbers, note: r.note, askedAt: r.createdAt.toISOString() },
    process.env.APP_URL?.trim() ?? "",
  );
}

/** Tries the API, then the chat. Never throws: a request that could not be delivered stays «طلب» and says why. */
async function deliver(payload: RequestPayload): Promise<{ via: "api" | "telegram" | "none"; error: string | null }> {
  let error: string | null = null;
  const api = hermesFromEnv();
  if (api) {
    try {
      await sendToHermesApi(api, payload);
      return { via: "api", error: null };
    } catch (e) {
      error = message(e);
    }
  }
  const chat = hermesChatFromEnv();
  if (chat) {
    try {
      await sendToHermesChat(chat, payload);
      return { via: "telegram", error: null };
    } catch (e) {
      error = [error, message(e)].filter(Boolean).join(" · ");
    }
  }
  return { via: "none", error };
}

/** The card on المهام follows the request: its column is the step, a cancelled request archives it (nothing is deleted). */
async function syncTask(r: VideoRequest, actor: Actor): Promise<void> {
  if (!r.taskId) return;
  const status = r.status as RequestStatus;
  await updateTask({ id: r.taskId, status: taskStatusOf(status), ...(status === "cancelled" ? { archived: true } : {}) }, actor);
}

export async function listVideoRequests(f: { status?: RequestStatus[]; product?: string; limit?: number } = {}): Promise<VideoRequestView[]> {
  const rows = await db.videoRequest.findMany({
    where: { ...(f.status?.length ? { status: { in: f.status } } : {}), ...(f.product ? { productCode: f.product } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(f.limit ?? 50, 200),
  });
  return rows.map(requestView);
}

/**
 * One request about one video. A second ask of the same kind on the same video while the first is still open returns the
 * first (nothing is asked twice). The numbers it carries are computed here, from the board — never taken from the caller.
 */
export async function createVideoRequest(input: VideoRequestCreateT, actor: Actor, now = new Date()): Promise<{ request: VideoRequestView; created: boolean }> {
  const refusal = refuseIfPrivate(input.note);
  if (refusal) throw new VideoRequestRefused(refusal);
  const video = await findBoardVideo(input.key, now);
  if (!video) throw new VideoRequestRefused("الفيديو مش بالبنك", 404);

  const existing = await db.videoRequest.findFirst({ where: { videoKey: video.key, kind: input.kind, status: { in: ["asked", "with_hermes", "ready"] } }, orderBy: { createdAt: "desc" } });
  if (existing) return { request: requestView(existing), created: false };

  const bank = video.job && video.vName ? await db.videoBankItem.findUnique({ where: { job_vName: { job: video.job, vName: video.vName } }, select: { driveFileId: true, scenarioFileId: true } }) : null;
  const asset = video.crCode ? await db.creativeAsset.findUnique({ where: { crCode: video.crCode }, select: { driveFileId: true } }) : null;
  const driveFileId = bank?.driveFileId ?? asset?.driveFileId ?? null;
  const scenarioFileId = bank?.scenarioFileId ?? null;

  let row = await db.videoRequest.create({
    data: {
      videoKey: video.key,
      kind: input.kind,
      productCode: video.product,
      job: video.job,
      vName: video.vName,
      crCode: video.crCode,
      driveFileId,
      scenarioFileId,
      numbers: json(numbersOf(video)),
      note: input.note ?? null,
      createdBy: actor.id ?? actor.type,
    },
  });

  // the card on المهام — the title says what is asked, the note carries what Hermes needs to start
  const payload = payloadOf(row);
  const task = await createTask(
    { title: requestTitle(input.kind, video).slice(0, 200), note: requestText(payload).slice(0, 1000), assignee: "hermes", executor: "hermes", priority: input.kind === "tired" ? "high" : "normal", link_type: "video", link_id: row.id },
    actor,
    "ui",
  );
  row = await db.videoRequest.update({ where: { id: row.id }, data: { taskId: task.id } });

  const sent = await deliver(payload);
  row = await db.videoRequest.update({
    where: { id: row.id },
    data: sent.via === "none" ? { via: "none", deliveryError: sent.error } : { via: sent.via, deliveredAt: now, status: "with_hermes", deliveryError: null },
  });
  if (sent.via !== "none") await syncTask(row, actor);

  // «تعب» is the owner saying the video is tired: its own flag in the bank follows (nothing else about the video changes)
  if (input.kind === "tired") {
    if (video.job && video.vName) await db.videoBankItem.updateMany({ where: { job: video.job, vName: video.vName }, data: { status: "fatigued" } });
    if (video.crCode) await db.creativeAsset.updateMany({ where: { crCode: video.crCode }, data: { status: "fatigued" } });
  }

  await audit(actor, "video.request", { type: "video_request", id: row.id }, { after: { key: video.key, kind: input.kind, via: row.via, status: row.status } });
  return { request: requestView(row), created: true };
}

/** The owner (or a teammate) moves a request along: with Hermes, ready, uploaded, or cancelled. */
export async function moveVideoRequest(id: string, to: RequestStatus, actor: Actor, now = new Date()): Promise<VideoRequestView> {
  if (!(REQUEST_STATUSES as readonly string[]).includes(to)) throw new VideoRequestRefused("حالة مش معروفة");
  const row = await db.videoRequest.findUnique({ where: { id } });
  if (!row) throw new VideoRequestRefused("الطلب مش موجود", 404);
  if (row.status === to) return requestView(row);
  if (!canMoveRequest(row.status as RequestStatus, to)) throw new VideoRequestRefused(`ما بينتقل من «${REQUEST_STATUS_AR[row.status as RequestStatus]}» لـ «${REQUEST_STATUS_AR[to]}»`, 409);
  const next = await db.videoRequest.update({
    where: { id },
    data: { status: to, ...(to === "ready" ? { readyAt: now } : {}), ...(to === "uploaded" ? { uploadedAt: now, readyAt: row.readyAt ?? now } : {}), ...(to === "asked" ? { claimedBy: null, claimedAt: null } : {}) },
  });
  await syncTask(next, actor);
  await audit(actor, "video.request.move", { type: "video_request", id }, { before: { status: row.status }, after: { status: to } });
  return requestView(next);
}

/** Hermes takes it: «عند هيرمز», with its name on it. A second taker gets a 409. */
export async function claimVideoRequest(id: string, by: string, actor: Actor, now = new Date()): Promise<VideoRequestView> {
  const row = await db.videoRequest.findUnique({ where: { id } });
  if (!row) throw new VideoRequestRefused("الطلب مش موجود", 404);
  const status = row.status as RequestStatus;
  if (status === "with_hermes" && row.claimedBy === by) return requestView(row);
  if (status === "with_hermes" && row.claimedBy) throw new VideoRequestRefused(`انأخد من ${row.claimedBy}`, 409);
  if (status !== "asked" && status !== "with_hermes") throw new VideoRequestRefused(`الطلب «${REQUEST_STATUS_AR[status]}» — ما بينأخد`, 409);
  const next = await db.videoRequest.update({ where: { id }, data: { status: "with_hermes", claimedBy: by, claimedAt: now } });
  await syncTask(next, actor);
  await audit(actor, "video.request.claim", { type: "video_request", id }, { after: { by } });
  return requestView(next);
}

/**
 * Hermes answers: the request is «جاهز». What it made (new hooks, a new scenario's videos) lands in the bank as «جاهز» — the
 * owner then uploads them and marks the request «مرفوع».
 */
export async function completeVideoRequest(id: string, input: VideoRequestCompleteT, by: string, actor: Actor, now = new Date()): Promise<VideoRequestView> {
  const refusal = refuseIfPrivate(input.note, ...Object.values(input.result ?? {}).map(String), ...(input.new_videos ?? []).map((v) => v.notes));
  if (refusal) throw new VideoRequestRefused(refusal);
  const row = await db.videoRequest.findUnique({ where: { id } });
  if (!row) throw new VideoRequestRefused("الطلب مش موجود", 404);
  const status = row.status as RequestStatus;
  if (!canMoveRequest(status, "ready")) throw new VideoRequestRefused(status === "ready" ? "الطلب جاهز من قبل" : `الطلب «${REQUEST_STATUS_AR[status]}» — ما بينجاوب`, 409);
  let made = 0;
  if (input.new_videos?.length) {
    const r = await applyVideos(
      input.new_videos.map((v) => ({ ...v, product: row.productCode, status: "ready" })),
      { actor, source: "mcp", now },
    );
    if (r.rejected.length) throw new VideoRequestRefused(`فيديو مرفوض: ${r.rejected[0]!.error}`);
    made = r.applied;
  }
  const next = await db.videoRequest.update({
    where: { id },
    data: { status: "ready", readyAt: now, claimedBy: row.claimedBy ?? by, claimedAt: row.claimedAt ?? now, resultNote: input.note ?? (made ? `${made} فيديو جديد بالبنك` : null), ...(input.result ? { result: json(input.result) } : {}) },
  });
  await syncTask(next, actor);
  await audit(actor, "video.request.complete", { type: "video_request", id }, { after: { by, newVideos: made } });
  return requestView(next);
}
