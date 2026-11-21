import { notFound } from "next/navigation";
import { KitShowcase } from "@/components/dev/kit-showcase";
import { can } from "@/core/roles";
import { currentCaller, requirePage } from "@/server/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "عدّة الشكل" };

/** Every component of the kit in every state (docs/rebuild/03-look.md §6). The owner only. */
export default async function KitPage() {
  await requirePage("owner_only");
  const caller = await currentCaller();
  if (!caller || !can(caller.role, "owner_only")) notFound();
  return <KitShowcase />;
}
