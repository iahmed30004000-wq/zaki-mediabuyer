"use client";

import { Play } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
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

/** What this page is, the next step, and «فرجيني»: opened by «شو هاي الصفحة؟» in the «⋯» menu of the header. */
export function PageHelpSheet({ place, open, onOpenChange }: { place: { key: string; label: string }; open: boolean; onOpenChange: (open: boolean) => void }) {
  const setOpen = onOpenChange;
  const g = guideOf(place.key);
  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{place.label}</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <section>
              <h3 className="mb-1 text-sm font-semibold text-fg-muted">شو هاي الصفحة</h3>
              <p className="text-sm leading-6 text-fg">{g.what}</p>
            </section>
            <section className="rounded-xl border border-accent/30 bg-accent/5 p-3">
              <h3 className="mb-1 text-sm font-semibold text-accent">شو بعدها</h3>
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
