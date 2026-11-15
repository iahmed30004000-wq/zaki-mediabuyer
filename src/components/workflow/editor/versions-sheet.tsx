"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { WfGraph } from "@/core/workflow";
import { diffText, graphDiff } from "@/core/workflow-edit";
import type { VersionView } from "@/server/workflows";

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const who = (s: string | null) => (!s ? "" : s === "system" ? "النظام" : s.startsWith("c") && s.length > 20 ? "المالك" : s);

/** Every saved version of the drawing. «افتحها كمسودة» puts an old one on the board as unsaved changes — saving it makes a NEW version, so history is never rewritten. */
export function VersionsSheet({ open, onClose, workflowKey, canEdit, demo, onLoad }: { open: boolean; onClose: () => void; workflowKey: string; canEdit: boolean; demo: boolean; onLoad: (g: WfGraph, version: number) => void }) {
  const [list, setList] = useState<VersionView[] | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open || demo) return;
    let alive = true;
    setList(null);
    setFailed(false);
    fetch(`/api/workflow/${workflowKey}/versions`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { versions: VersionView[] }) => alive && setList(d.versions))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [open, workflowKey, demo]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>نسخ الرسم</SheetTitle>
          <SheetDescription>كل حفظ نسخة جديدة. الرجوع لنسخة قديمة بيعمل نسخة جديدة منها — ما في شي بينحذف.</SheetDescription>
        </SheetHeader>
        <SheetBody>
          {demo ? <p className="rounded-lg border border-dashed border-border p-3 text-sm leading-6 text-fg-muted">هاد الموقع على البيانات التجريبية: ما في نسخ محفوظة. لما يشتغل على الحقيقي (MOCK_MODE=0) كل حفظ بيعمل نسخة هون.</p> : failed ? <p className="text-sm text-danger">ما قدرت أجيب النسخ — جرّب كمان مرة.</p> : list === null ? <p className="text-sm text-fg-muted">…</p> : (
            <ol className="space-y-2">
              {list.map((v, i) => {
                const older = list[i + 1];
                const change = v.note ?? (older ? diffText(graphDiff(older.graph, v.graph)) : "");
                return (
                  <li key={v.version} className="space-y-1.5 rounded-xl border border-border bg-surface-1 p-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-bold text-fg">النسخة {v.version}</span>
                      {v.current ? <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent">الحالية</span> : null}
                      <span className="ms-auto text-xs text-fg-muted">{when(v.createdAt)}</span>
                    </div>
                    {change ? <p className="text-xs leading-5 text-fg">{change}</p> : null}
                    <p className="text-[11px] text-fg-muted">{v.graph.nodes.length} خطوة · {v.graph.edges.length} وصلة{v.createdBy ? ` · ${who(v.createdBy)}` : ""}</p>
                    {canEdit && !v.current ? (
                      <Button size="sm" variant="secondary" className="min-h-9" onClick={() => onLoad(v.graph, v.version)}>
                        افتحها كمسودة
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
