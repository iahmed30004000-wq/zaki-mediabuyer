"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Circle } from "lucide-react";
import type { SetupStep } from "@/lib/mock/data";
import { ArtSlot } from "@/components/theme/art-slot";
import { cn } from "@/lib/utils";

/**
 * The set-up as ONE list: the next step open, the rest folded. Each step says why in one line and how in two.
 * The keys themselves never go through the site — they go into .env by hand (spec 0.1.3).
 */
export function SetupChecklist({ steps }: { steps: SetupStep[] }) {
  const firstOpen = steps.find((s) => !s.done)?.key ?? null;
  const [open, setOpen] = useState<string | null>(firstOpen);
  const done = steps.filter((s) => s.done).length;

  return (
    <div className="space-y-4 rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5">
      <ArtSlot slot="guide-connect" className="max-h-36 w-full rounded-xl object-cover" />
      <div>
        <h1 className="text-xl font-bold text-fg">جهّز النظام</h1>
        <p className="text-sm text-fg-muted">{done} من {steps.length} جاهزين. لحد ما يخلصوا، كل الشاشات شغّالة على بيانات تجريبية.</p>
        <div className="mt-3 h-2 rounded-full bg-surface-2">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
      </div>
      <ol className="space-y-2">
        {steps.map((s, i) => {
          const isOpen = open === s.key;
          return (
            <li key={s.key} className={cn("rounded-xl border", isOpen ? "border-accent/50" : "border-border")}>
              <button onClick={() => setOpen(isOpen ? null : s.key)} aria-expanded={isOpen} className="flex min-h-12 w-full items-center gap-3 px-3 text-start">
                {s.done ? (
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-ok text-ok-fg"><Check className="size-4" /></span>
                ) : (
                  <span className="inline-flex size-6 items-center justify-center rounded-full border border-border text-xs text-fg-muted">{i + 1}</span>
                )}
                <span className={cn("flex-1 text-sm font-medium", s.done ? "text-fg-muted" : "text-fg")}>{s.title}</span>
                <ChevronDown className={cn("size-4 text-fg-muted transition-transform", isOpen && "rotate-180")} />
              </button>
              {isOpen ? (
                <div className="space-y-2 px-3 pb-3 ps-12 text-sm">
                  <p className="text-fg"><span className="font-semibold">ليش؟ </span>{s.why}</p>
                  <p className="text-fg-muted"><span className="font-semibold text-fg">كيف؟ </span>{s.how}</p>
                  {s.who === "owner" && !s.done ? (
                    <p className="inline-flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1 text-xs text-warn">
                      <Circle className="size-3" /> هاي عليك — ولا تلصق أي مفتاح بالمحادثة، بملف .env بإيدك
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      <Link href="/" className="flex min-h-11 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-fg hover:bg-accent/90">
        كمّل عالموقع (بيانات تجريبية)
      </Link>
    </div>
  );
}
