"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleHelp, Play } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { PAGE_GUIDE } from "@/lib/guide";
import type { Place } from "@/lib/nav";
import "driver.js/dist/driver.css";
import "@/components/ui/tour.css";

/** Runs the page tour with driver.js (loaded only when somebody asks for it). Steps whose target is not on the page are skipped. */
async function runTour(key: Place["key"]) {
  const { driver } = await import("driver.js");
  const steps = PAGE_GUIDE[key].tour
    .filter((s) => document.querySelector(`[data-tour="${s.target}"]`))
    .map((s) => ({ element: `[data-tour="${s.target}"]`, popover: { title: s.title, description: s.text } }));
  if (!steps.length) return;
  driver({ steps, showProgress: true, progressText: "{{current}} من {{total}}", nextBtnText: "التالي", prevBtnText: "رجوع", doneBtnText: "خلصت", popoverClass: "zaki-tour" }).drive();
}

/** The «؟» of every page: what this page is, the next step, and «فرجيني». */
export function PageHelp({ place }: { place: Place }) {
  const [open, setOpen] = useState(false);
  const g = PAGE_GUIDE[place.key];
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label="شو هاي الصفحة؟" className="inline-flex size-9 items-center justify-center rounded-lg border border-border text-fg-muted hover:bg-surface-2 hover:text-fg">
        <CircleHelp className="size-[18px]" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{place.label}</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <section>
              <h3 className="mb-1 text-xs font-semibold text-fg-muted">شو هاي الصفحة</h3>
              <p className="text-sm leading-6 text-fg">{g.what}</p>
            </section>
            <section className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <h3 className="mb-1 text-xs font-semibold text-accent">الخطوة الجاية</h3>
              <p className="text-sm leading-6 text-fg">{g.next}</p>
            </section>
            <div className="flex flex-wrap gap-2">
              <Button
                onClick={() => {
                  setOpen(false);
                  setTimeout(() => void runTour(place.key), 250);
                }}
              >
                <Play className="size-4" />
                فرجيني
              </Button>
              <Link href="/guide" onClick={() => setOpen(false)} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-sm text-fg hover:bg-surface-2">
                الدليل كامل
              </Link>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
