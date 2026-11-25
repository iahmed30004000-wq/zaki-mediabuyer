"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { safeFetch } from "@/lib/call";

/** «رجّع»: reverts a change that ran (the existing `rollback` of /api/changes/[id]). Asks «متأكد؟» first. */
export function RollbackButton({ id }: { id: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      loading={busy}
      confirm="متأكد؟"
      onClick={async () => {
        setBusy(true);
        try {
          const r = await safeFetch(`/api/changes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "rollback" }) });
          const d = (await r.json().catch(() => ({}))) as { error?: string; state?: string };
          if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
          // the answer says what really happened: bringing spend back is only a request until it is approved
          if (d.state === "executed") toast("انرجع ✓", "success");
          else if (d.state === "pending_approval") toast("لسا ما رجع: وافق عليه من «بانتظارك»", "info");
          else toast("ما انرجع — شوف «بانتظارك»", "error");
          router.refresh();
        } finally {
          setBusy(false);
        }
      }}
    >
      رجّع
    </Button>
  );
}
