import { BackLink } from "@/components/ui/back-link";
import { NewJob, type DoerOption } from "@/components/tasks/new-job";
import { teamLabel } from "@/core/directory";
import { SITE_KEY } from "@/core/job-draft";
import { requirePage } from "@/server/auth";
import { loadDirectory } from "@/server/directory";

export const dynamic = "force-dynamic";
export const metadata = { title: "مهمة جديدة" };

/**
 * المهام ← مهمة جديدة: four questions (مين · إيمتى · شو تعمل · إيمتى أخبّرك) or one of six templates, and a bar that says the whole thing in a sentence with «اعتمد المهمة». The people and
 * the agents come from the team directory; the site's own row is not one of them (its jobs are recipes, which are not built yet). Only the owner and the manager make jobs (`work.create`).
 */
export default async function NewTaskPage() {
  await requirePage("work.create");
  const people: DoerOption[] = (await loadDirectory()).filter((e) => e.key !== SITE_KEY).map((e) => ({ key: e.key, name: e.name, kind: e.kind, hint: e.kind === "agent" ? "وكيل" : e.team ? teamLabel(e.team) : "شخص" }));
  return (
    <div className="space-y-4">
      <BackLink href="/tasks">المهام</BackLink>
      <header>
        <h2 className="font-display text-lg font-extrabold text-fg">مهمة جديدة</h2>
        <p className="text-base text-fg-muted">ركّبها بأربع أسئلة، أو ابدأ من قالب. ما بينحفظ شي قبل ما تضغط «اعتمد المهمة».</p>
      </header>
      <NewJob people={people} />
    </div>
  );
}
