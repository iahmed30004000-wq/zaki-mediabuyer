/**
 * M01 — the live monitor (spec 11.2 / 11.4), internal model only. After a safety rule acted, it reads the decision
 * and the numbers around it and says whether the action looks right and whether a person is needed NOW. It changes
 * nothing: its note is logged under the decision, and «needs a person now» becomes an alert.
 */
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { ask, AgentUnavailable, PrivacyRefusal } from "@/gateway";

const Note = z.object({ likely_cause: z.string().max(240), action_ok: z.boolean(), needs_human_now: z.boolean(), note: z.string().max(300) });

export async function explainSafety(changeSetId: string, facts: string[]): Promise<z.infer<typeof Note> | null> {
  const cs = await db.changeSet.findUnique({ where: { id: changeSetId }, select: { sentence: true, kind: true, state: true } });
  if (!cs) return null;
  try {
    const n = await ask("M01", [
      { role: "user", content: [`قاعدة أمان تصرفت (${cs.kind}, ${cs.state}): «${cs.sentence}»`, "اقرأ الأرقام تحت وقول: شو السبب المحتمل، هل التصرف صح، وهل لازم إنسان هلأ. ولا رقم من عندك.", `رجّع JSON: {"likely_cause":"…","action_ok":true,"needs_human_now":false,"note":"…"}`, ...facts.map((f) => `- ${f}`)].join("\n") },
    ], Note);
    await audit({ type: "agent", id: "M01" }, "change.explain", { type: "changeset", id: changeSetId }, { after: n });
    if (n.needs_human_now || !n.action_ok) {
      await db.alert.create({ data: { kind: "agent.M01", tone: "warn", text: `المراقب: ${n.note}${n.action_ok ? "" : " — شكّ إنه القرار بمحله، راجعه"}`, href: "/decisions" } });
    }
    return n;
  } catch (e) {
    if (e instanceof AgentUnavailable || e instanceof PrivacyRefusal) return null;
    throw e;
  }
}
