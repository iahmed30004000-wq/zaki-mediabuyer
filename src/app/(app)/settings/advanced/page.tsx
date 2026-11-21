import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ADVANCED_PAGES } from "@/lib/settings-nav";
import { requirePage } from "@/server/auth";

export const metadata = { title: "متقدّم" };

/** الإعدادات ← متقدّم: اللي بتحتاجه قليل — التخصيص، الأتمتة والجدولة، الإدخال اليدوي، السجل، الدليل. */
export default async function AdvancedPage() {
  await requirePage("settings.view");
  return (
    <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface-1">
      {ADVANCED_PAGES.map((p) => (
        <li key={p.href}>
          <Link href={p.href} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-surface-2">
            <span className="min-w-0 flex-1">
              <span className="block text-base font-extrabold text-fg">{p.title}</span>
              <span className="block text-sm text-fg-muted">{p.line}</span>
            </span>
            <ChevronLeft className="size-5 shrink-0 text-fg-muted" aria-hidden />
          </Link>
        </li>
      ))}
    </ul>
  );
}
