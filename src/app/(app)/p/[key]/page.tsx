import { notFound, redirect } from "next/navigation";
import { effectivePages } from "@/core/customize";
import { BUILTIN_PAGES } from "@/lib/nav";
import { getUiConfig } from "@/server/ui-config";
import { requirePage } from "@/server/auth";

export const dynamic = "force-dynamic";

async function pageOf(key: string) {
  const page = effectivePages(await getUiConfig(), BUILTIN_PAGES).find((p) => p.key === key && !p.builtin);
  return page && !page.archived ? page : null;
}

export async function generateMetadata({ params: paramsP }: { params: Promise<{ key: string }> }) {
  const params = await paramsP;
  return { title: (await pageOf(params.key))?.label ?? "صفحة" };
}

/**
 * A page the owner made in the old edit mode. A board of tasks is one more board of the team's tasks now: `/work/tasks` opened on it (the same cards, fields and
 * buttons). A link just goes where it points. An old bookmark or a stored alert keeps working; new pages of this kind are not made any more.
 */
export default async function CustomPage({ params: paramsP }: { params: Promise<{ key: string }> }) {
  await requirePage(["tasks.own", "tasks.manage"]);
  const params = await paramsP;
  const page = await pageOf(params.key);
  if (!page) notFound();
  if (page.kind === "link") redirect(page.href);
  redirect(`/work/tasks?board=${encodeURIComponent(page.board ?? "main")}`);
}
