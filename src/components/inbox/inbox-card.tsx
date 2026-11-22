"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DecisionCard } from "@/components/ui/decision-card";
import { useToast } from "@/components/ui/toast";
import { inboxHref, splitItemId, type InboxActionKey, type InboxItem } from "@/core/inbox";
import { safeFetch } from "@/lib/call";

const DONE: Partial<Record<InboxActionKey, string>> = {
  approve: "وافقت ✓",
  choose: "سجّلت اختيارك ✓",
  send: "وافقت ✓ — Claude بيبعتها",
  reject: "رفضت",
  later: "تأجّلت",
  complete: "تمّت ✓",
  keep: "خلّيتها ✓",
  merge: "انضمّت — وClaude رح يشيلها",
  cancel: "انلغت",
};

/** Sends a press to the endpoint that already does it — nothing new can spend money from here. Returns an error sentence, or null. */
async function send(item: InboxItem, key: InboxActionKey, extra?: { until?: string; option?: string }): Promise<{ error: string | null; demo: boolean }> {
  const ids = splitItemId(item.id);
  if (!ids) return { error: "قرار مش معروف", demo: false };
  let url = "";
  let method = "POST";
  let body: Record<string, unknown> = {};
  if (ids.source === "change") {
    url = `/api/changes/${ids.rowId}`;
    body = { action: key === "approve" ? "approve" : "reject" };
  } else if (ids.source === "approval") {
    url = `/api/approvals/${ids.rowId}`;
    // W-09: the answer goes with its own key — «reject» only for the refusal, any other option is an answer of its own
    body = key === "later" ? { action: "postpone", until: extra?.until ?? "1h" } : { action: key === "reject" ? "reject" : "approve", ...(extra?.option ? { option: extra.option } : {}) };
  } else if (ids.source === "order") {
    url = `/api/orders/${ids.rowId}`;
    body = { action: key === "reject" ? "reject" : "approve" };
  } else if (ids.source === "advice") {
    url = "/api/work/decisions";
    body = { items: [{ key: ids.rowId, decision: key === "cancel" ? "cancel" : key === "merge" ? "merge" : "keep" }] };
  } else {
    url = `/api/handoffs/${ids.rowId}`;
    method = "PATCH";
    body = key === "cancel" ? { action: "cancel" } : { action: "complete" };
  }
  const r = await safeFetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = (await r.json().catch(() => ({}))) as { error?: string; demo?: boolean };
  return { error: r.ok ? null : (d.error ?? "صار خطأ"), demo: !!d.demo };
}

/**
 * A decision card wired to the site: the press goes to the endpoint of its source (the change, the request, the handoff), the card says
 * what happened, and the page re-reads itself — so the item leaves the list and the red number goes down.
 */
export function InboxCard({ item, compact, afterDecide }: { item: InboxItem; compact?: boolean; afterDecide?: (key: InboxActionKey) => void }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<string | null>(null);

  async function act(key: InboxActionKey, extra?: { until?: string; option?: string }) {
    if (key === "open") return router.push(inboxHref(item.id));
    if (busy) return;
    if (item.demo) {
      toast("بالوضع التجريبي ما تغيّر شي", "info");
      return;
    }
    setBusy(true);
    try {
      const r = await send(item, key, extra);
      if (r.error) return toast(r.error, "error");
      if (r.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
      setResolved(DONE[key] ?? "تمّ");
      toast(DONE[key] ?? "تمّ", "success");
      afterDecide?.(key);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return <DecisionCard item={item} onAction={act} busy={busy} resolved={resolved} {...(compact !== undefined ? { compact } : {})} />;
}
