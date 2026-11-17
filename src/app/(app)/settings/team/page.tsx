import { FoldCard } from "@/components/settings/fold-card";
import { AgentTokens, ActorsPanel, ConnectedApps, type TokenRow } from "@/components/settings/team-directory";
import { AgentsTable, MatrixLegend, RolesTable } from "@/components/settings/permission-matrix";
import { TeamPanel } from "@/components/settings/editors";
import { agentMatrix, roleMatrix } from "@/core/permissions";
import { isDemo } from "@/core/readiness";
import { can } from "@/core/roles";
import { fmt } from "@/lib/format";
import { loadEditView, loadSettingsView } from "@/lib/settings-view";
import { currentCaller } from "@/server/auth";
import { db } from "@/server/db";
import { appOrigin } from "@/server/env";
import { loadDirectory } from "@/server/directory";
import { listConnected } from "@/server/oauth";

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
  const [directory, edit, real, tokens, accounts, connected] = await Promise.all([
    loadDirectory({ includeInactive: true }),
    loadEditView(),
    loadSettingsView(),
    owner ? db.apiToken.findMany({ where: { oauthClientId: null, OR: [{ scopes: { has: "mcp" } }, { scopes: { hasSome: ["mcp:read", "mcp:push", "mcp:run", "mcp:ask", "mcp:tasks", "mcp:handoff", "mcp:videos"] } }] }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, scopes: true, actorKey: true, lastUsedAt: true, revokedAt: true } }) : Promise.resolve([]),
    demo ? Promise.resolve([]) : db.adAccount.findMany({ select: { name: true, autonomyLevel: true } }),
    owner && !demo ? listConnected() : Promise.resolve([]),
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
    <div className="space-y-3">
      <FoldCard id="team" open title="الناس" summary={edit ? `${edit.team.length} حساب · كل واحد بدور جاهز، بدون خانات تعدّلها` : "بتظهر لما يشتغل الموقع على البيانات الحقيقية"}>
        {edit ? <TeamPanel team={edit.team} me={me && !me.demo ? me.id : null} /> : <p className="text-sm text-fg-muted">الحسابات بتظهر لما يشتغل الموقع على البيانات الحقيقية.</p>}
      </FoldCard>

      <FoldCard id="directory" title="دليل الفريق" summary={`${directory.filter((a) => a.active).length} بالدليل — الأسماء والفرق ورقم تيليجرام: بيانات، مش كود`}>
        {owner ? <ActorsPanel actors={directory} users={edit?.team.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, email: u.email })) ?? []} /> : <p className="text-sm text-fg-muted">التعديل للمالك.</p>}
      </FoldCard>

      {owner ? (
        <FoldCard id="agents" title="توكنات الوكلاء" summary={`${tokenRows.filter((t) => !t.revoked).length} توكن شغّال · ${connected.filter((c) => c.active).length} تطبيق موصّل · كل واحد بيفتح أدوات معيّنة بس`}>
          <AgentTokens agents={agents.map((a) => ({ key: a.key, name: a.name }))} tokens={tokenRows} />
          <h3 className="pt-3 text-sm font-bold text-fg">تطبيقات متصلة بالموصّل (claude.ai)</h3>
          <ConnectedApps clients={connected} url={`${appOrigin()}/mcp`} />
        </FoldCard>
      ) : null}

      {real ? (
        <FoldCard id="model-cap" title="سقف صرف الموديل" summary={`${fmt(real.monthUsd, "$")} من ${fmt(real.monthCap, "$", 0)} هالشهر`}>
          <p className="text-sm text-fg-muted">الوكلاء بيفسّروا وبيكتبوا بس — ما حدا منهم بيلمس ميتا ولا بيشوف بيانات زبون. الخارجيين بيوقفوا عند السقف.</p>
        </FoldCard>
      ) : null}

      <FoldCard id="matrix" title="مين بيقدر شو" summary="الجدول بيقرا الدور ومستوى الحساب ونطاقات التوكن والحدود الثابتة — مش نسخة مكتوبة باليد">
        <h3 className="text-sm font-bold text-fg">الناس</h3>
        <RolesTable sections={roleMatrix()} />
        <h3 className="pt-2 text-sm font-bold text-fg">الوكلاء</h3>
        <AgentsTable sections={matrix} agents={agents.map((a) => ({ key: a.key, name: a.name }))} />
        <MatrixLegend />
      </FoldCard>
    </div>
  );
}
