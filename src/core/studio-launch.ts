/**
 * THE STUDIO'S LAUNCH REQUEST (docs/STUDIO_DATA_CONTRACT_AR.md §4.2 #2–4, HANDOFF E1). Pure.
 *
 * The request launches nothing by itself: it feeds the normal intake and the owner launches from the wizard. So its
 * status is not stored — it is derived, every time, from the records it is linked to (the creative and the change set).
 */
import { z } from "zod";
import { isVpId } from "./studio-contract";

export const MAX_VIDEO_BYTES = 500 * 1024 * 1024;

export const STATUSES = ["received", "preparing", "awaiting_approval", "launched", "rejected", "failed", "cancelled"] as const;
export type LaunchStatus = (typeof STATUSES)[number];
export const ENDED = ["rejected", "failed", "cancelled"] as const;
export const CANCELLABLE = ["received", "preparing", "awaiting_approval"] as const;

/** The `meta` part (a JSON string). `thumbnail` is a base64 PNG: stored nowhere. */
export const LaunchMetaSchema = z.object({
  vp_id: z.string().refine(isVpId, "VP-{code}-{n}-v{v}"),
  product_id: z.union([z.string(), z.number()]).transform(String),
  store_id: z.union([z.string(), z.number()]).transform(String),
  country: z.string().regex(/^[A-Z]{2}$/),
  mode: z.enum(["active", "test"]),
  framework: z.string(),
  pattern_id: z.string(),
  hook_line: z.string(),
  dialect: z.string(),
  duration_sec: z.number(),
  script_text: z.string().max(20_000),
  captions_srt: z.string().max(100_000),
  checksum_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  character_id: z.string().nullable().optional(),
  thumbnail: z.string().optional(),
  hook_group: z.string().optional(),
  hook_index: z.number().int().optional(),
});
export type LaunchMeta = z.infer<typeof LaunchMetaSchema>;

/** `VP-TRF01-0012-v2` → `TRF01`; null when the second segment is not one of our product codes (never guessed). */
export function productCodeOf(vpId: string): string | null {
  const seg = vpId.split("-")[1];
  return seg && /^[A-Z]{3}\d{2}$/.test(seg) ? seg : null;
}

/** An earlier request for the same (vp_id, mode): `same` → answer with it; `conflict` → 409; else a new one. */
export function duplicateDecision(existing: { status: string; checksum: string } | null, checksum: string): "new" | "same" | "conflict" {
  if (!existing || (ENDED as readonly string[]).includes(existing.status)) return "new";
  return existing.checksum === checksum ? "same" : "conflict";
}

export interface RequestFacts {
  closedStatus: string | null;
  reason: string | null;
  crCode: string | null;
}
export interface AssetFacts {
  status: string;
  policyFlag: string;
  policyNote: string | null;
  dupOf: string | null;
  metaVideoId: string | null;
}
export interface ChangeFacts {
  state: string;
  error: string | null;
}

/**
 * The table of HANDOFF E1.4, in this order of priority: cancelled/closed by us → the launch change set ended →
 * the creative died on the way to Meta → the policy guard / a duplicate → ready to launch → being prepared → received.
 */
export function deriveStatus(r: RequestFacts, asset: AssetFacts | null, cs: ChangeFacts | null): { status: LaunchStatus; reason: string | null } {
  if (r.closedStatus && (STATUSES as readonly string[]).includes(r.closedStatus)) return { status: r.closedStatus as LaunchStatus, reason: r.reason };
  if (cs?.state === "executed") return { status: "launched", reason: null };
  if (cs?.state === "rejected") return { status: "rejected", reason: cs.error ?? "المالك رفض الإطلاق" };
  if (cs?.state === "failed") return { status: "failed", reason: cs.error ?? "فشل الإطلاق عند ميتا" };
  if (asset?.status === "dead") return { status: "failed", reason: asset.policyNote ?? "ما انرفع الفيديو لميتا بعد 5 محاولات" };
  if (asset && (asset.status === "excluded" || asset.policyFlag === "red" || asset.dupOf)) {
    return { status: "rejected", reason: asset.dupOf ? `نسخة من ${asset.dupOf}` : asset.policyNote ?? "انستبعد بفحص السياسات" };
  }
  if ((asset?.metaVideoId && (asset.status === "ready" || asset.status === "uploaded")) || cs?.state === "pending_approval") return { status: "awaiting_approval", reason: null };
  if (asset) return { status: "preparing", reason: asset.policyFlag === "yellow" ? "بانتظار موافقتك على ملاحظة السياسات" : null };
  return { status: "received", reason: null };
}

/** The studio's way of naming a market → our `ProductEconomics.market`; what we know about a product, and nothing else. */
export interface ProductFacts {
  price?: { amount: number; currency: "USD" };
  country?: string;
  cod: true;
  delivery?: { fee: number };
}

/**
 * Only the keys we truly know (HANDOFF E1.3): a missing key means «unknown» to the studio, an empty list would mean
 * «no offer». So `offer_tiers` and `guarantee` are never sent.
 */
export function productFacts(e: { market: string; price: { toString(): string }; deliveryFee: { toString(): string } }, country: string | null): ProductFacts | null {
  if (country && e.market && country !== e.market) return null;
  const price = Number(e.price.toString());
  const fee = Number(e.deliveryFee.toString());
  return {
    ...(price > 0 ? { price: { amount: price, currency: "USD" as const } } : {}),
    ...(e.market ? { country: e.market } : {}),
    cod: true,
    ...(fee >= 0 ? { delivery: { fee } } : {}),
  };
}
