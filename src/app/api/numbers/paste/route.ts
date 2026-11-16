import { NextResponse } from "next/server";
import { z } from "zod";
import { MAX_PASTE_CHARS, parsePaste } from "@/core/paste-parse";
import { PASTE_LEVELS, checkRows } from "@/core/push-rows";
import { errorResponse, HttpError, requireCapability } from "@/server/auth";
import { directoryKeys } from "@/server/directory";
import { applyMetrics } from "@/server/push";

export const dynamic = "force-dynamic";

const Body = z
  .object({
    text: z.string().max(MAX_PASTE_CHARS + 1000),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "التاريخ بصيغة YYYY-MM-DD"),
    level: z.enum(PASTE_LEVELS),
    /** false (the default): only read the paste and say what it holds; true: store the rows that are fine */
    apply: z.boolean().optional(),
  })
  .strict();

/**
 * POST /api/numbers/paste — «ألصق أرقام». The owner pastes a table he copied (an Ads Manager export, a sheet); the code reads it
 * (src/core/paste-parse.ts), checks every row as every push is checked, and — only with `apply` — stores the good rows the same way
 * Claude's pushes are stored (source «manual»: the Meta and OMS jobs overwrite them later). The server reads the text again on
 * apply; it never trusts rows sent from the screen. Reading is allowed on the demo too (it changes nothing); storing is not.
 */
export async function POST(req: Request) {
  try {
    const caller = await requireCapability("owner_only");
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw new HttpError(400, "طلب غير مفهوم: " + parsed.error.issues.slice(0, 2).map((i) => i.message).join(" · "));
    const { text, day, level, apply } = parsed.data;
    const read = parsePaste(text, { day, level });
    const checked = checkRows(read.rows.map((r) => r.row), await directoryKeys());
    const problems = [...read.issues, ...checked.problems.map((p) => ({ line: read.rows[p.index]?.line ?? 0, error: p.error }))].sort((a, b) => a.line - b.line);
    const summary = {
      delimiter: read.delimiter,
      mapped: read.mapped,
      unmapped: read.unmapped,
      valid: checked.rows.length,
      problems: problems.slice(0, 30),
      problemCount: problems.length,
      sample: checked.rows.slice(0, 5).map((r) => r.row),
    };
    if (!apply) return NextResponse.json({ ok: true, ...summary });
    if (process.env.MOCK_MODE === "1" || caller.demo) return NextResponse.json({ ok: true, demo: true, ...summary });
    if (!checked.rows.length) throw new HttpError(400, "ما في صف صالح للإدخال — شوف المشاكل تحت");
    const report = await applyMetrics(checked.rows.map((r) => r.row), { actor: { type: "user", id: caller.id }, source: "manual" });
    return NextResponse.json({ ok: true, applied: report.applied, insights: report.insights, structure: report.structure, rejected: report.rejected.length, rejectedList: report.rejected.slice(0, 5).map((r) => ({ line: read.rows[r.index]?.line ?? 0, error: r.error })), warnings: report.warnings.slice(0, 5), ...summary });
  } catch (e) {
    return errorResponse(e);
  }
}
