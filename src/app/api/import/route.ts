import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { getSetting } from "@/server/settings";
import { FIELDS, guessMapping, parseCsv, readRows, type Field } from "@/io/import";

const Body = z.object({
  fileName: z.string().min(1).max(200),
  /** CSV as text, or an .xlsx as base64 */
  text: z.string().max(15_000_000).optional(),
  base64: z.string().max(20_000_000).optional(),
  mapping: z.record(z.enum(FIELDS), z.number().int().min(0).max(500)).optional(),
  commit: z.boolean().optional(),
});

async function tableOf(b: z.infer<typeof Body>): Promise<string[][]> {
  if (b.text !== undefined) return parseCsv(b.text);
  if (!b.base64) throw new HttpError(400, "ما في ملف");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(b.base64, "base64") as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw new HttpError(400, "الملف فاضي");
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as unknown[]).slice(1).map((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v && typeof v === "object" && "result" in v ? String((v as { result: unknown }).result ?? "") : String(v ?? "")));
    out.push(values);
  });
  return out;
}

/**
 * POST /api/import — Meta's daily per-ad export into the archive (spec S13). Without `commit`: the columns as guessed,
 * a preview and every problem, nothing stored. With `commit`: rows upserted on (ad, day) with source «import»; a file
 * already imported (same fingerprint) is said and changes nothing.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("connect_meta");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "الملف كبير أو مش مفهوم");
    const b = parsed.data;
    const table = await tableOf(b);
    if (table.length < 2) throw new HttpError(400, "الملف ما فيه أسطر");
    const headers = table[0]!;
    const mapping = (b.mapping ?? guessMapping(headers)) as Partial<Record<Field, number>>;
    const { rows, errors } = readRows(table, mapping);
    const sha256 = createHash("sha256").update(b.text ?? b.base64 ?? "").digest("hex");
    const already = await db.importBatch.findUnique({ where: { kind_sha256: { kind: "meta_insights", sha256 } } });

    // which ads we know (by id, else by name)
    const ids = [...new Set(rows.map((r) => r.adId).filter((x): x is string => !!x))];
    const names = [...new Set(rows.filter((r) => !r.adId).map((r) => r.adName!))];
    const byId = new Set((await db.ad.findMany({ where: { metaId: { in: ids } }, select: { metaId: true } })).map((a) => a.metaId));
    const byName = new Map((await db.ad.findMany({ where: { name: { in: names } }, select: { metaId: true, name: true } })).map((a) => [a.name, a.metaId]));
    // only ads we know are stored: an unknown id or name stays out (its numbers have no product to land on)
    const resolved = rows.map((r) => ({ ...r, objectId: r.adId ? (byId.has(r.adId) ? r.adId : null) : byName.get(r.adName!) ?? null }));
    const unknown = resolved.filter((r) => !r.objectId).length;

    if (!b.commit || process.env.MOCK_MODE === "1") {
      return NextResponse.json({
        headers,
        mapping,
        rows: rows.length,
        unknownAds: unknown,
        already: already ? { at: already.createdAt.toISOString(), rows: already.rows } : null,
        errors: errors.slice(0, 20),
        preview: resolved.slice(0, 5).map((r) => ({ day: r.day.toISOString().slice(0, 10), ad: r.adId ?? r.adName, spend: r.spend, impressions: r.impressions, purchases: r.purchases, known: !!r.objectId })),
        ...(b.commit ? { demo: true } : {}),
      });
    }
    if (errors.some((e) => !e.includes("مكرر"))) throw new HttpError(422, errors.slice(0, 5).join(" · "));
    if (already) return NextResponse.json({ ok: true, repeated: true, rows: 0, message: `هالملف انستورد قبل (${already.rows} سطر) — ما تغيّر شي` });
    const window = String(await getSetting("attribution.window"));
    let n = 0;
    for (const r of resolved) {
      if (!r.objectId) continue;
      const data = { spend: r.spend, impressions: Math.round(r.impressions), reach: Math.round(r.reach), frequency: r.reach ? r.impressions / r.reach : 0, linkClicks: Math.round(r.linkClicks), outboundClicks: Math.round(r.linkClicks), lpv: Math.round(r.lpv), purchases: Math.round(r.purchases), conversations: 0, video3s: Math.round(r.video3s), thruplays: Math.round(r.thruplays), p25: 0, p50: 0, p75: 0, p95: 0, p100: 0, attributionSetting: window, source: "import" };
      await db.insightDaily.upsert({ where: { level_objectId_date: { level: "ad", objectId: r.objectId, date: r.day } }, create: { level: "ad", objectId: r.objectId, date: r.day, ...data }, update: data });
      n++;
    }
    await db.importBatch.create({ data: { kind: "meta_insights", sha256, fileName: b.fileName, rows: n, unknownAds: unknown, byUser: caller.id } });
    await audit({ type: "user", id: caller.id }, "import.meta_insights", { type: "file", id: b.fileName }, { after: { rows: n, unknownAds: unknown } });
    return NextResponse.json({ ok: true, rows: n, unknownAds: unknown, message: `انستورد ${n} سطر${unknown ? ` · ${unknown} لإعلانات مش معروفة (ما انحفظوا)` : ""} — الحقيقة بتنحسب بالدورة الجاية` });
  } catch (e) {
    return errorResponse(e);
  }
}
