/** The creatives as the screen draws them: the demo list, or the registry (MOCK_MODE=0) mapped to the same card. */
import { db } from "@/server/db";
import { CREATIVES, type Creative, type CreativeStage } from "@/lib/mock/data";

export type CreativeView = Creative & { live: boolean; thumb?: string | null; fileName?: string | null; metaVideoId?: string | null };

const STAGE: Record<string, CreativeStage> = { inbox: "inbox", review: "review", ready: "ready", uploaded: "ready", dead: "ready", live: "live", paused: "live", winner: "live", fatigued: "fatigued", excluded: "excluded" };

export async function loadCreatives(): Promise<CreativeView[]> {
  if (process.env.MOCK_MODE === "1") return CREATIVES.map((c) => ({ ...c, live: false }));
  const rows = await db.creativeAsset.findMany({ orderBy: { dateIn: "desc" }, take: 200, include: { thumbnails: { orderBy: { frameIndex: "asc" }, take: 1 } } });
  return rows.map((r) => ({
    code: r.crCode,
    product: r.productCode ?? "—",
    stage: STAGE[r.status] ?? "inbox",
    duration: Math.round(Number(r.durationS ?? 0)),
    aspect: (r.aspect as Creative["aspect"]) ?? "9:16",
    hook: r.hookType ?? undefined,
    angle: r.angle ?? undefined,
    dialect: r.dialect ?? undefined,
    policy: (r.policyFlag as Creative["policy"]) ?? "pending",
    policyNote: r.policyNote ?? (r.status === "dead" ? "ما انرفع لميتا بعد 5 محاولات" : undefined),
    dupOf: r.dupOf ?? undefined,
    live: true,
    thumb: r.thumbnails[0] ? `/api/creatives/${r.crCode}/thumb/${r.thumbnails[0].frameIndex}` : null,
    fileName: r.fileName,
    metaVideoId: r.metaVideoId,
  }));
}

/** The excluded-by-duplicate files are not registry rows: they are DriveFile rows. */
export async function loadDuplicates(): Promise<{ name: string; product: string; dupOf: string | null; reason: string | null }[]> {
  if (process.env.MOCK_MODE === "1") return [];
  const rows = await db.driveFile.findMany({ where: { status: "excluded" }, orderBy: { createdAt: "desc" }, take: 50 });
  return rows.map((r) => ({ name: r.originalName, product: r.productCode ?? "—", dupOf: r.error?.match(/CR\d{5}/)?.[0] ?? null, reason: r.error }));
}
