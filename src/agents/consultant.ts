/**
 * M10 — the consultant (spec S14 / 11.4). A short answer in the owner's dialect from the facts the code gathered
 * here: every number carries its source (ميتا · حقيقي · تقدير), drafts only, at most one clarifying question. The facts
 * are aggregates — no order, no customer, no identifier ever reaches the model. Without a model the facts themselves
 * are the answer.
 */
import { db } from "@/server/db";
import { ask, AgentUnavailable, PrivacyRefusal } from "@/gateway";
import { LEVEL_AR } from "@/lib/mock/data";

const usd = (n: number | null | undefined) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${n.toFixed(2)}$`);

/** The facts pack, one line each, every number tagged with where it comes from. */
export async function consultFacts(now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const lines: string[] = [];
  for (const a of await db.adAccount.findMany()) {
    lines.push(`حساب ${a.name}: المستوى ${a.autonomyLevel} (${LEVEL_AR[a.autonomyLevel as 0 | 1 | 2 | 3] ?? "—"}) · السقف اليومي ${usd(a.dailyCap ? Number(a.dailyCap) : null)}`);
  }
  for (const e of await db.productEconomics.findMany()) {
    const rows = await db.truthDaily.findMany({ where: { level: "product", objectId: e.productCode, date: { gte: since } } });
    if (!rows.length) continue;
    const spend = rows.reduce((n, r) => n + Number(r.spendWithFee), 0);
    const confirmed = rows.reduce((n, r) => n + r.confirmed, 0);
    const delivered = rows.reduce((n, r) => n + r.delivered, 0);
    const profit = rows.reduce((n, r) => n + Number(r.profitAfterCosts), 0);
    const ceiling = rows.map((r) => r.scalingCeiling).filter(Boolean).pop();
    lines.push(`${e.name} (${e.productCode}) آخر 7 أيام [حقيقي]: صرف ${usd(spend)} · مؤكد ${confirmed} · تكلفة المؤكد ${usd(confirmed ? spend / confirmed : null)} · السقف ${usd(ceiling ? Number(ceiling) : null)} · مُسلَّم ${delivered} · ربح بعد التكاليف ${usd(profit)}${e.source === "actual" ? "" : " · أرقام المنتج [تقدير]"} · المخزون ${e.stockDays ?? "—"} يوم`);
  }
  const pending = await db.changeSet.findMany({ where: { state: { in: ["pending_approval", "simulated"] } }, select: { sentence: true, spendDeltaDaily: true }, take: 10 });
  if (pending.length) lines.push(`بانتظار المالك: ${pending.length} تغيير (${pending.map((p) => `${p.sentence.slice(0, 80)} [${Number(p.spendDeltaDaily) >= 0 ? "+" : ""}${Number(p.spendDeltaDaily)}$/يوم]`).join(" | ")})`);
  const auto = await db.changeSet.findMany({ where: { source: "rule", state: "executed", executedAt: { gte: new Date(now.getTime() - 86_400_000) } }, select: { sentence: true }, take: 8 });
  for (const a of auto) lines.push(`قرار أمان آخر 24 ساعة: ${a.sentence.slice(0, 160)}`);
  const alerts = await db.alert.findMany({ where: { readAt: null }, orderBy: { createdAt: "desc" }, take: 5, select: { text: true } });
  for (const a of alerts) lines.push(`تنبيه: ${a.text.slice(0, 160)}`);
  const plan = await db.report.findFirst({ where: { kind: "plan" }, orderBy: { forDate: "desc" }, select: { text: true } });
  if (plan) {
    const p = JSON.parse(plan.text) as { total_usd: number; daily_allocation: { product_code: string; bucket: string; usd: number }[] };
    lines.push(`خطة الأسبوع [الكود]: ${usd(p.total_usd)} باليوم — ${p.daily_allocation.map((x) => `${x.product_code} ${x.bucket} ${usd(x.usd)}`).join(" · ")}`);
  }
  return [...new Set(lines)];
}

export async function consult(question: string, place: string): Promise<{ answer: string; by: "agent" | "code"; facts: string[] }> {
  const facts = await consultFacts();
  try {
    const answer = await ask("M10", [
      {
        role: "user",
        content: [
          `المالك هلأ بصفحة «${place}» وسأل: «${question.slice(0, 500)}»`,
          "جاوب بالأردني بثلاث لأربع جمل. كل رقم من الحقائق تحت بس، ومعه مصدره بين قوسين (ميتا · حقيقي · تقدير). إذا الحقائق ما بتكفي قول «غير كافي» وشو الناقص. إذا بدك تغيير، اكتبه كمسودة («بقترح…») — إنت ما بتنفّذ شي. سؤال توضيحي واحد كحد أقصى.",
          "الحقائق:",
          ...facts.map((f) => `- ${f}`),
        ].join("\n"),
      },
    ]);
    return { answer: answer.replace(/<think>[\s\S]*?<\/think>/g, "").trim(), by: "agent", facts };
  } catch (e) {
    if (!(e instanceof AgentUnavailable || e instanceof PrivacyRefusal)) throw e;
    return { answer: facts.length ? "ما في موديل موصول هلأ، فهاي الأرقام اللي بتلزمك من الكود مباشرة:" : "ما في موديل موصول، ولسا ما في أرقام كافية بالقاعدة.", by: "code", facts };
  }
}
