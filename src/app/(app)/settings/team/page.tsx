import { AgentTokens, ActorsPanel, type TokenRow } from "@/components/settings/team-directory";
import { AgentsTable, MatrixLegend, RolesTable } from "@/components/settings/permission-matrix";
import { TeamPanel } from "@/components/settings/editors";
import { SectionTitle } from "@/components/ui/section-title";
import { agentMatrix, roleMatrix } from "@/core/permissions";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { loadEditView } from "@/lib/settings-view";
import { currentCaller } from "@/server/auth";
import { db } from "@/server/db";
import { loadDirectory } from "@/server/directory";

export const metadata = { title: "الفريق والصلاحيات" };
export const dynamic = "force-dynamic";

const ago = (d: Date | null) => {
  if (!d) return null;
  const m = Math.round((Date.now() - d.getTime()) / 60_000);
  return m < 60 ? `قبل ${Math.max(m, 1)} دقيقة` : m < 48 * 60 ? `قبل ${Math.round(m / 60)} ساعة` : `قبل ${Math.round(m / 1440)} يوم`;
};

/**
 * الإعدادات ← الفريق والصلاحيات (docs/rebuild/05-permissions.md §4, §7): the people with their roles, the directory (people and agents, as data), the agents'
 * tokens with the scopes each holds, and «مين بيقدر شو» — one table that reads the four systems and prints what is true. The owner changes things here;
 * a manager only reads.
 */
export default async function TeamSettingsPage() {
  const me = await currentCaller();
  const owner = !!me && !me.demo && can(me.role, "owner_only");
  const demo = isDemo(process.env);
  const [directory, edit, tokens, accounts] = await Promise.all([
    loadDirectory({ includeInactive: true }),
    loadEditView(),
    owner ? db.apiToken.findMany({ where: { OR: [{ scopes: { has: "mcp" } }, { scopes: { hasSome: ["mcp:read", "mcp:push", "mcp:run", "mcp:ask", "mcp:tasks", "mcp:handoff", "mcp:videos"] } }] }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, scopes: true, actorKey: true, lastUsedAt: true, revokedAt: true } }) : Promise.resolve([]),
    demo ? Promise.resolve([]) : db.adAccount.findMany({ select: { name: true, autonomyLevel: true } }),
  ]);
  const agents = directory.filter((a) => a.kind === "agent" && a.active);
  const names = new Map(directory.map((a) => [a.key, a.name]));
  const tokenRows: TokenRow[] = tokens.map((t) => ({ id: t.id, name: t.name, prefix: t.prefix, scopes: t.scopes, actorKey: t.actorKey, actorName: t.actorKey ? names.get(t.actorKey) ?? t.actorKey : null, lastUsed: ago(t.lastUsedAt), revoked: !!t.revokedAt }));
  const live = (key: string) => tokens.filter((t) => !t.revokedAt && t.actorKey === key).map((t) => t.scopes);
  const matrix = agentMatrix(
    agents.map((a) => ({ key: a.key, name: a.name, tokenScopes: live(a.key) })),
    accounts.map((a) => ({ name: a.name, level: a.autonomyLevel })),
  );
  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionTitle hint="كل واحد بدور جاهز — بدون خانات تعدّلها">الناس</SectionTitle>
        {edit ? <TeamPanel team={edit.team} me={me && !me.demo ? me.id : null} /> : <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">الحسابات بتظهر لما يشتغل الموقع على البيانات الحقيقية.</p>}
      </section>

      <section className="space-y-3">
        <SectionTitle hint="الأسماء والفرق ورقم تيليجرام — بيانات، مش كود">دليل الفريق</SectionTitle>
        {owner ? <ActorsPanel actors={directory} users={edit?.team.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, email: u.email })) ?? []} /> : <p className="rounded-card border border-dashed border-border p-4 text-sm text-fg-muted">{directory.length} بالدليل — التعديل للمالك.</p>}
      </section>

      {owner ? (
        <section className="space-y-3">
          <SectionTitle hint="كل توكن بيفتح أدوات معيّنة بس">توكنات الوكلاء</SectionTitle>
          <AgentTokens agents={agents.map((a) => ({ key: a.key, name: a.name }))} tokens={tokenRows} />
        </section>
      ) : null}

      <section className="space-y-3">
        <SectionTitle hint="الجدول بيقرا الأنظمة الأربعة: الدور، مستوى الحساب، نطاقات التوكن، والحدود الثابتة">مين بيقدر شو</SectionTitle>
        <h3 className="text-sm font-bold text-fg">الناس</h3>
        <RolesTable sections={roleMatrix()} />
        <h3 className="pt-2 text-sm font-bold text-fg">الوكلاء</h3>
        <AgentsTable sections={matrix} agents={agents.map((a) => ({ key: a.key, name: a.name }))} />
        <MatrixLegend />
      </section>
    </div>
  );
}
