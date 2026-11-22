"use client";

import Link from "next/link";
import { ListPlus, Megaphone } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCan } from "./shell-context";

/** What the «＋» can start. Only what has a real screen is offered: «مهمة جديدة» joins when its screen exists (P4-1), «أمر ساري» is written from the job's page. */
export const PLUS_ITEMS = [
  { key: "person_task", href: "/tasks/team", label: "مهمة لشخص", hint: "لحدا من الفريق، بموعد", cap: "tasks.manage", icon: ListPlus },
  { key: "launch", href: "/ads", label: "إطلاق حملة", hint: "من صفحة الإعلانات، بزر «＋ إطلاق»", cap: "ads.view", icon: Megaphone },
] as const;

/** The panel of the «＋»: big rows, each a link to the place where that thing is made. */
export function PlusSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const manage = useCan("tasks.manage");
  const ads = useCan("ads.view");
  const items = PLUS_ITEMS.filter((i) => (i.cap === "tasks.manage" ? manage : ads));
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>شو بدك تعمل؟</SheetTitle>
        </SheetHeader>
        <SheetBody className="space-y-2">
          {items.length === 0 ? <p className="text-base text-fg-muted">ما في شي تبدأه من هون لدورك.</p> : null}
          {items.map((i) => {
            const Icon = i.icon;
            return (
              <Link key={i.key} href={i.href} onClick={() => onOpenChange(false)} className="flex min-h-[68px] items-center gap-3 rounded-xl border border-border bg-surface-1 px-4 py-3 shadow-key-line active:translate-y-0.5">
                <Icon className="size-6 shrink-0 text-fg-muted" aria-hidden />
                <span className="min-w-0">
                  <b className="block text-base font-bold text-fg">{i.label}</b>
                  <span className="block text-sm text-fg-muted">{i.hint}</span>
                </span>
              </Link>
            );
          })}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
