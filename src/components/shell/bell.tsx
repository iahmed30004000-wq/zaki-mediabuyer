"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Lamp } from "@/components/ui/lamp";
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { BellItem } from "@/core/bell";
import { callJson } from "@/lib/call";
import { setBadge } from "@/lib/push-client";
import { cn } from "@/lib/utils";

interface BellData {
  unread: number;
  items: BellItem[];
}

const KEY = ["bell"] as const;

async function fetchBell(): Promise<BellData> {
  const r = await callJson<BellData>("/api/notifications", { cache: "no-store" });
  if (!r.ok || !r.data) throw new Error(r.error ?? "ما قدرنا نقرا الإشعارات");
  return r.data;
}

/**
 * THE BELL (docs/rebuild-v6/02-screens.md §7): an icon in the header with the number of notices not read yet; a press opens a panel with the last 30 (a lamp · the title · when · a link)
 * and «علّم الكل مقروء». It asks every 60 seconds while the tab is visible. A notice is the person's own; the panel only reads and marks — it sends nothing.
 */
export function BellButton() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { data, isError } = useQuery({ queryKey: KEY, queryFn: fetchBell, staleTime: 20_000, refetchInterval: 60_000, refetchIntervalInBackground: false });
  const markAll = useMutation({
    mutationFn: async () => {
      const r = await callJson("/api/notifications/read", { method: "POST", body: {} });
      if (!r.ok) throw new Error(r.error ?? "ما انعلّمت");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
  const unread = data?.unread ?? 0;
  // the number on the app's icon, where the phone can show one (05-notify.md §6)
  useEffect(() => {
    if (data) setBadge(data.unread);
  }, [data]);
  return (
    <>
      <IconButton aria-label={unread ? `الإشعارات — ${unread} ما انقرت` : "الإشعارات"} title="الإشعارات" onClick={() => setOpen(true)} className="relative">
        <Bell className="size-5" aria-hidden />
        {unread ? (
          <span aria-hidden className="absolute end-1 top-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1 text-sm font-bold tabular-nums text-danger-fg">
            {unread > 99 ? "99+" : unread}
          </span>
        ) : null}
      </IconButton>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>الإشعارات</SheetTitle>
          </SheetHeader>
          <SheetBody className="space-y-3">
            {unread ? (
              <Button variant="secondary" size="sm" loading={markAll.isPending} onClick={() => markAll.mutate()}>
                علّم الكل مقروء
              </Button>
            ) : null}
            {markAll.isError ? <p className="text-base text-danger">{markAll.error instanceof Error ? markAll.error.message : "ما انعلّمت"}</p> : null}
            {isError ? <p className="text-base text-danger">ما قدرنا نقرا الإشعارات — جرّب كمان شوي.</p> : null}
            {data && data.items.length === 0 ? <p className="text-base text-fg-muted">ما في إشعارات.</p> : null}
            <ul className="m-0 list-none divide-y divide-border p-0">
              {(data?.items ?? []).map((n) => {
                const body = (
                  <span className="flex items-start gap-3 py-3">
                    <Lamp state={n.lamp} size={14} className="mt-1.5" />
                    <span className="min-w-0 flex-1">
                      <b className={cn("block text-base", n.unread ? "font-bold text-fg" : "font-medium text-fg-muted")}>{n.title}</b>
                      {n.body ? <span className="block text-sm text-fg-muted">{n.body}</span> : null}
                      <span className="block text-sm text-fg-muted">{n.when}</span>
                    </span>
                  </span>
                );
                return <li key={n.id}>{n.href ? <Link href={n.href} onClick={() => setOpen(false)}>{body}</Link> : body}</li>;
              })}
            </ul>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </>
  );
}
