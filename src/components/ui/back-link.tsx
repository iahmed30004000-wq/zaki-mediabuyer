import Link from "next/link";
import type { ComponentProps } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * «رجوع» with an arrow that points the right way in Arabic (docs/rebuild-v6/03-look.md §7): back is TO THE RIGHT in a right-to-left page, so the arrow is drawn
 * pointing right and turns round by itself in a left-to-right one. It replaces the «←» typed into a sentence, which pointed forward in Arabic.
 */
export function BackLink({ href, children = "رجوع", className, ...props }: Omit<ComponentProps<typeof Link>, "children"> & { children?: React.ReactNode }) {
  return (
    <Link href={href} className={cn("inline-flex min-h-11 items-center gap-1.5 text-base font-semibold text-fg-muted hover:text-fg", className)} {...props}>
      <ArrowRight className="size-5 shrink-0 ltr:rotate-180" aria-hidden />
      {children}
    </Link>
  );
}
