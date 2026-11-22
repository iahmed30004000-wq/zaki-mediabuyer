"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/** «سجّل الـ webhook» and «افحصه» for Telegram's «اوقف»: the site does it with the keys it already has — nobody types a token. */
export function TelegramHook() {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<string | null>(null);

  async function call(method: "GET" | "POST") {
    setBusy(true);
    const r = await fetch("/api/telegram/register", { method }).catch(() => null);
    const d = (await r?.json().catch(() => ({}))) as { error?: string; demo?: boolean; registered?: boolean; pending?: number; lastError?: string | null; url?: string };
    setBusy(false);
    if (!r || !r.ok) return toast(d?.error ?? "ما زبط، جرّب كمان مرة", "error");
    if (d.demo) return toast("بالوضع التجريبي ما بيتسجّل شي", "info");
    if (method === "POST") {
      setLine("انسجّل ✓");
      return toast("تيليجرام صار يبعت «اوقف» للموقع ✓", "success");
    }
    setLine(d.registered ? `مسجّل ✓ · ${d.pending ?? 0} بالانتظار${d.lastError ? ` · آخر خطأ: ${d.lastError}` : ""}` : "مش مسجّل على هالموقع — اضغط «سجّل»");
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void call("POST")}>
        سجّل الـ webhook
      </Button>
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => void call("GET")}>
        افحصه
      </Button>
      {line ? <span className="text-sm text-fg-muted">{line}</span> : null}
    </div>
  );
}
