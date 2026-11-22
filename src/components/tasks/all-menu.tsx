"use client";

import Link from "next/link";
import { Ellipsis } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { IconButton } from "@/components/ui/icon-button";

/** The «⋯» of «كل المهام»: «قرّر عليهم مرة وحدة» (the decision sheet) · «نسخة للطباعة» · «نظّف المكرّر» (only when the site found a pair that looks like one job twice). */
export function AllMenu({ canDecide, duplicates }: { canDecide: boolean; duplicates: number }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton aria-label="المزيد" title="المزيد">
          <Ellipsis className="size-5" aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canDecide ? (
          <DropdownMenuItem asChild>
            <Link href="/tasks/all?decide=1">قرّر عليهم مرة وحدة</Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild>
          <a href="/print/work" target="_blank" rel="noreferrer">
            نسخة للطباعة
          </a>
        </DropdownMenuItem>
        {canDecide && duplicates > 0 ? (
          <DropdownMenuItem asChild>
            <Link href="/tasks/all?tidy=1">نظّف المكرّر ({duplicates})</Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
