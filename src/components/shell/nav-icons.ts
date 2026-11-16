import { ExternalLink, Link2, ListTodo, type LucideIcon } from "lucide-react";
import type { EffPage } from "@/core/customize";

/** The icon of a page of «وضع التعديل» (retired in P11): a board or a link the owner made. The five places carry their own icon (src/lib/nav.ts). */
export function iconOfPage(p: Pick<EffPage, "kind" | "external">): LucideIcon {
  if (p.kind === "board") return ListTodo;
  return p.external ? ExternalLink : Link2;
}
