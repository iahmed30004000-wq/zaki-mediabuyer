"use client";

import { useState } from "react";
import { CircleHelp, Play } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { IconButton } from "@/components/ui/icon-button";
import { guideOf } from "@/lib/guide";
import "driver.js/dist/driver.css";
import "@/components/ui/tour.css";

/** Runs the page tour with driver.js (loaded only when somebody asks for it). Steps whose target is not on the page are skipped. */
export async function runTour(key: string) {
  const { driver } = await import("driver.js");
  const steps = guideOf(key).tour
    .filter((s) => document.querySelector(`[data-tour="${s.target}"]`))
    .map((s) => ({ element: `[data-tour="${s.target}"]`, popover: { title: s.title, description: s.text } }));
  if (!steps.length) return;
  driver({ steps, showProgress: true, progressText: "{{current}} من {{total}}", nextBtnText: "التالي", prevBtnText: "رجوع", doneBtnText: "خلصت", popoverClass: "zaki-tour" }).drive();
}

/** The «؟» of every page: what this page is, the next step, and «فرجيني». */
export function PageHelp({ place }: { place: { key: string; label: string } }) {
  const [open, setOpen] = useState(false);
  const g = guideOf(place.key);
  return (
    <>
      <IconButton aria-label="شو هاي الصفحة؟" title="شو هاي الصفحة؟" onClick={() => setOpen(true)}>
        <CircleHelp className="size-5" aria-hidden />
      </IconButton>
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
              <ButtonLink href="/settings/advanced/guide" variant="secondary" onClick={() => setOpen(false)}>
                الدليل والمصطلحات
              </ButtonLink>
            </div>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
