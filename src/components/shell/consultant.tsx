"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircleQuestion, Send } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { placeOf } from "@/lib/nav";

/** Fired by the header button on phones. */
export const CONSULTANT_EVENT = "mb:consultant";

const STARTERS: Record<string, string[]> = {
  today: ["ليش وقف CR00174؟", "كم باقي من سقف اليوم؟"],
  ads: ["أي منتج رابح فعلاً هالأسبوع؟", "ليش في فرق بين ميتا والحقيقة بحملة الكمأة؟"],
  creatives: ["أي هوك بيجيب أرخص مؤكد؟", "شو البديل الآمن لـ «يشفي»؟"],
  decisions: ["إذا وافقت على الزيادة، كم بيصير صرف اليوم؟"],
  reports: ["لخّصلي الأسبوع بتلات أسطر"],
  settings: ["شو الفرق بين المستوى 1 و 2؟"],
};

/**
 * The consultant (spec S14) is not a place: a button on every page that knows where you are. It drafts and explains;
 * it never touches Meta. In demo mode it shows the starters; the model gateway answers once connected (Phase 5).
 */
export function Consultant() {
  const place = placeOf(usePathname() ?? "/");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ me: boolean; text: string }[]>([]);

  // On a phone the button lives in the page header (no floating button over the content): it sends this event.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(CONSULTANT_EVENT, show);
    return () => window.removeEventListener(CONSULTANT_EVENT, show);
  }, []);

  const ask = (text: string) => {
    if (!text.trim()) return;
    setLog((l) => [...l, { me: true, text }, { me: false, text: "بالوضع التجريبي ما في موديل موصول. بعد الربط بجاوبك من أرقامك، وكل رقم بمصدره (ميتا · حقيقي · تقدير)، ومسودات بس — ولا تنفيذ." }]);
    setQ("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 end-6 z-30 hidden h-12 items-center gap-2 rounded-full bg-accent px-4 text-sm font-semibold text-accent-fg shadow-card hover:bg-accent/90 md:inline-flex"
      >
        <MessageCircleQuestion className="size-5" />
        <span>اسأل المستشار</span>
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>المستشار</SheetTitle>
            <SheetDescription>بيفهم إنك هلأ بـ «{place.label}». بيشرح وبيجهّز مسودات، وما بيلمس ميتا.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            {log.length === 0 ? (
              <div className="flex flex-wrap gap-2">
                {(STARTERS[place.key] ?? []).map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg hover:border-accent/60 hover:bg-accent/5">
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              log.map((m, i) => (
                <p key={i} className={m.me ? "ms-8 rounded-xl bg-accent px-3 py-2 text-sm text-accent-fg" : "me-8 rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg"}>
                  {m.text}
                </p>
              ))
            )}
          </SheetBody>
          <SheetFooter className="flex-nowrap">
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(q);
              }}
            >
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="اكتب سؤالك…" className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-fg" />
              <button type="submit" aria-label="ابعت" className="inline-flex size-11 items-center justify-center rounded-lg bg-accent text-accent-fg">
                <Send className="size-4 rtl:-scale-x-100" />
              </button>
            </form>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
