import { ExternalLink, Link2, ListTodo, type LucideIcon } from "lucide-react";
import type { EffPage } from "@/core/customize";
import { PLACES } from "@/lib/nav";

/** The icon of a page: the place's own, or one for a board or a link the owner made. */
export function iconOfPage(p: Pick<EffPage, "key" | "builtin" | "kind" | "external">): LucideIcon {
  if (p.builtin) return PLACES.find((x) => x.key === p.key)?.icon ?? ListTodo;
  if (p.kind === "board") return ListTodo;
  return p.external ? ExternalLink : Link2;
}
