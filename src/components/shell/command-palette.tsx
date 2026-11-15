"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { groupHits, rank, searchable, type SearchHit, type SearchItem } from "@/core/search";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-context";

/** Opens the search box from anywhere (the header's button sends it). */
export const SEARCH_EVENT = "mb:search";

/**
 * The search box: Ctrl+K (⌘K), or the magnifier in the header. The pages answer at once from what the shell already knows; the
 * data (products, workflows, tasks, videos, ads, campaigns) comes from /api/search a moment after the typing stops. Arrow keys
 * move, Enter goes, Esc closes. It never opens on top of another dialog (no modal on a modal).
 */
export function CommandPalette() {
  const router = useRouter();
  const { pages } = useShell();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const show = useCallback(() => {
    // another dialog or sheet is open: leave it alone
    if (document.querySelector('[role="dialog"][data-state="open"]')) return;
    setOpen(true);
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (open) setOpen(false);
        else show();
      }
    };
    window.addEventListener("keydown", key);
    window.addEventListener(SEARCH_EVENT, show);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener(SEARCH_EVENT, show);
    };
  }, [open, show]);

  // a fresh box each time
  useEffect(() => {
    if (open) return;
    setQ("");
    setData([]);
    setActive(0);
  }, [open]);

  // the data, a moment after the typing stops
  useEffect(() => {
    if (!open || !searchable(q)) {
      setData([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : { hits: [] }))
        .then((d: { hits: SearchHit[] }) => setData(d.hits ?? []))
        .catch(() => undefined)
        .finally(() => !ctl.signal.aborted && setBusy(false));
    }, 180);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q, open]);

  const pageItems = useMemo<SearchItem[]>(() => pages.filter((p) => !p.archived).map((p) => ({ kind: "page", id: p.key, title: p.label, sub: p.question, href: p.href })), [pages]);
  const hits = useMemo(() => (searchable(q) ? rank(q, [...pageItems, ...data], 24) : pageItems.filter((p) => !pages.find((x) => x.key === p.id)?.hidden).map((p) => ({ ...p, score: 1 }))), [q, pageItems, data, pages]);
  const groups = useMemo(() => groupHits(hits), [hits]);
  const flat = useMemo(() => groups.flatMap((g) => g.hits), [groups]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    document.querySelector(`[data-hit="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const go = (h: SearchHit | undefined) => {
    if (!h) return;
    setOpen(false);
    if (/^https?:/.test(h.href)) window.open(h.href, "_blank", "noopener,noreferrer");
    else router.push(h.href);
  };

  let n = -1;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg" className="p-0" onOpenAutoFocus={(e) => (e.preventDefault(), input.current?.focus())}>
        <DialogTitle className="sr-only">بحث</DialogTitle>
        <DialogDescription className="sr-only">دوّر على صفحة أو منتج أو إعلان أو فيديو أو مهمة أو ورك فلو</DialogDescription>
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 pe-14">
          <Search className="size-4 shrink-0 text-fg-muted" aria-hidden />
          <input
            ref={input}
            value={q}
            dir="auto"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((a) => Math.min(flat.length - 1, a + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                go(flat[active]);
              }
            }}
            role="combobox"
            aria-expanded
            aria-controls="mb-search-list"
            aria-activedescendant={flat[active] ? `mb-hit-${active}` : undefined}
            aria-label="بحث"
            placeholder="دوّر: صفحة، منتج، إعلان، فيديو، مهمة…"
            className="min-h-9 w-full bg-transparent text-sm text-fg outline-none placeholder:text-fg-muted/70"
          />
          {busy ? <span className="shrink-0 text-[11px] text-fg-muted">…</span> : null}
        </div>
        <div id="mb-search-list" role="listbox" className="max-h-[60vh] overflow-y-auto overscroll-contain p-2">
          {groups.map((g) => (
            <div key={g.kind} role="group" aria-label={g.label} className="mb-2 last:mb-0">
              <p className="px-2 pb-1 pt-1 text-[11px] font-semibold text-fg-muted">{g.label}</p>
              {g.hits.map((h) => {
                const i = ++n;
                return (
                  <button
                    key={`${h.kind}:${h.id}`}
                    id={`mb-hit-${i}`}
                    data-hit={i}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseMove={() => setActive(i)}
                    onClick={() => go(h)}
                    className={cn("flex min-h-11 w-full flex-col items-start justify-center rounded-lg px-3 py-1.5 text-start", i === active ? "bg-accent/10 text-fg" : "text-fg hover:bg-surface-2")}
                  >
                    <span dir="auto" className="w-full truncate text-sm font-medium">{h.title}</span>
                    {h.sub ? <span dir="auto" className="w-full truncate text-[11px] text-fg-muted">{h.sub}</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
          {!flat.length ? <p className="px-3 py-6 text-center text-sm text-fg-muted">{searchable(q) ? (busy ? "عم أدوّر…" : "ما لقيت شي بهالاسم") : "اكتب اسم صفحة أو منتج أو إعلان أو فيديو أو مهمة"}</p> : null}
        </div>
        <p className="hidden border-t border-border px-4 py-2 text-[11px] text-fg-muted md:block">↑ ↓ للتنقل · Enter للفتح · Esc للإغلاق · Ctrl K بأي صفحة</p>
      </DialogContent>
    </Dialog>
  );
}
