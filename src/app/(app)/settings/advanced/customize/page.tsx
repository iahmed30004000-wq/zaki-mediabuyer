import { CustomizeHub } from "@/components/settings/customize-hub";
import { SectionTitle } from "@/components/ui/section-title";
import { effectivePages } from "@/core/customize";
import { BUILTIN_PAGES } from "@/lib/nav";
import { getUiConfig } from "@/server/ui-config";

export const metadata = { title: "التخصيص" };
export const dynamic = "force-dynamic";

/**
 * الإعدادات ← متقدّم ← التخصيص: «وضع التعديل» للّوحات والحقول والأزرار والمحذوفات (وبتظهر على البطاقات متل ما كانت). الصفحات الخمس ثابتة، فتبويب «الصفحات»
 * انشال؛ الروابط اللي عملها المالك لحاله بتنعرض تحت بـ «روابطي».
 */
export default async function CustomizePage() {
  const mine = effectivePages(await getUiConfig(), BUILTIN_PAGES).filter((p) => !p.builtin && p.kind === "link" && !p.archived);
  return (
    <div className="space-y-6">
      <CustomizeHub />
      {mine.length ? (
        <section className="space-y-3">
          <SectionTitle hint="روابط عملتها بنفسك">روابطي</SectionTitle>
          <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
            {mine.map((p) => (
              <li key={p.key}>
                <a href={p.href} className="flex min-h-10 max-md:min-h-[48px] items-center gap-3 px-4 py-2 text-sm font-bold text-fg hover:bg-surface-2">
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
