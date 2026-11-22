import { BackLink } from "@/components/ui/back-link";
import { NewJob, type DoerOption } from "@/components/tasks/new-job";
import { teamLabel } from "@/core/directory";
import { SITE_KEY } from "@/core/job-draft";
import { isDemo } from "@/core/readiness";
import { DRAFT_NEEDS_KEY, assistantConfigured, externalModelsOff } from "@/server/assistant/config";
import { requirePage } from "@/server/auth";
import { db } from "@/server/db";
import { loadDirectory } from "@/server/directory";

export const dynamic = "force-dynamic";
export const metadata = { title: "مهمة جديدة" };

/**
 * المهام ← مهمة جديدة: four questions (مين · إيمتى · شو تعمل · إيمتى أخبّرك), a sentence the assistant turns into a draft, or one of six templates — and a bar that says the whole thing in a sentence with
 * «اعتمد المهمة». The people and the agents come from the team directory; the site's own row is «الموقع لحاله» and its jobs are the four recipes. The sentence needs the assistant's key: with none the tab
 * says how to connect it, and the other two ways keep working. Only the owner and the manager make jobs (`work.create`).
 */
export default async function NewTaskPage() {
  await requirePage("work.create");
  const directory = await loadDirectory();
  const demo = isDemo(process.env);
  const people: DoerOption[] = directory
    .filter((e) => e.key !== SITE_KEY)
    .map((e) => ({ key: e.key, name: e.name, kind: e.kind, hint: e.kind === "agent" ? "وكيل" : e.team ? teamLabel(e.team) : "شخص" }));
  // the site itself is a doer only when the directory has its row (the migration puts it there) — its jobs are recipes
  if (directory.some((e) => e.key === SITE_KEY && e.active)) people.push({ key: SITE_KEY, name: "الموقع لحاله", kind: "agent", hint: "وصفات جاهزة" });
  const products = demo ? [] : (await db.productEconomics.findMany({ select: { productCode: true, name: true }, orderBy: { productCode: "asc" } })).map((p) => ({ code: p.productCode, name: p.name }));
  const on = !demo && (await assistantConfigured()) && !externalModelsOff();
  return (
    <div className="space-y-4">
      <BackLink href="/tasks">المهام</BackLink>
      <header>
        <h2 className="font-display text-lg font-extrabold text-fg">مهمة جديدة</h2>
        <p className="text-base text-fg-muted">ركّبها بأربع أسئلة، أو اكتبها بجملة، أو ابدأ من قالب. ما بينحفظ شي قبل ما تضغط «اعتمد المهمة».</p>
      </header>
      <NewJob people={people} products={products} assistant={{ on, message: DRAFT_NEEDS_KEY }} />
    </div>
  );
}
