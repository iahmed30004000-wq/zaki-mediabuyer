"use client";

import { useState } from "react";
import { OctagonX } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { useToast } from "@/components/ui/toast";
import { useMission } from "@/components/mb/mission";
import { cn } from "@/lib/utils";
import { callJson } from "@/lib/call";
import { stopSentence, type StopResult } from "@/core/stop-result";

/**
 * The full stop (spec 10.3, 18.2): always visible at the top, in the risk frame. Two confirmations:
 * pick what to stop (the REAL ad accounts, read on the server), then type «اوقف». The answer is what the server counted per campaign — never a made-up «done».
 */
export interface StopAccount {
  id: string;
  name: string;
}

export function KillSwitch({ compact = false, accounts = [] }: { compact?: boolean; accounts?: StopAccount[] }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("all");
  const [typed, setTyped] = useState("");
  const { toast } = useToast();
  const mission = useMission();
  const [busy, setBusy] = useState(false);
  const ready = typed.trim() === "اوقف";

  return (
    <>
      {compact ? (
        <IconButton tone="danger" onClick={() => setOpen(true)} data-tour="kill" aria-label="الإيقاف الكامل" title="الإيقاف الكامل">
          <OctagonX className="size-5" aria-hidden />
        </IconButton>
      ) : (
        <>
          <IconButton tone="danger" className="md:hidden" onClick={() => setOpen(true)} aria-label="الإيقاف الكامل" title="الإيقاف الكامل">
            <OctagonX className="size-5" aria-hidden />
          </IconButton>
          <Button variant="secondary" data-tour="kill" className="hidden border-danger text-danger hover:bg-danger/10 md:inline-flex" onClick={() => setOpen(true)} aria-label="الإيقاف الكامل">
            <OctagonX className="size-4" aria-hidden />
            إيقاف كامل
          </Button>
        </>
      )}
      <Modal
        open={open}
        title="إيقاف كامل"
        onClose={() => {
          setOpen(false);
          setTyped("");
        }}
      >
        <div className="space-y-4">
          <p className="text-sm text-fg">بيوقف الحملات الشغّالة بميتا. بترجعها من «بانتظارك ← قررتها» بزر رجّع، وكل شي بينسجّل.</p>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-fg-muted">شو بدك توقف؟</legend>
            {[{ id: "all", name: "كل الحسابات" }, ...accounts].map((o) => (
              <label key={o.id} className="flex min-h-10 max-md:min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border border-border px-3 has-[:checked]:border-danger/60 has-[:checked]:bg-danger/5">
                <input type="radio" name="scope" value={o.id} checked={scope === o.id} onChange={() => setScope(o.id)} className="accent-[rgb(var(--danger))]" />
                <span className="text-sm text-fg">{o.name}</span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">للتأكيد اكتب «اوقف»</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-10 max-md:h-[44px] w-full rounded-lg border border-border bg-surface px-3 text-fg" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              لا، رجوع
            </Button>
            <Button
              variant="danger"
              disabled={!ready || busy}
              onClick={async () => {
                setBusy(true);
                const r = await callJson<StopResult & { demo?: boolean; sentence?: string }>("/api/kill-switch", { method: "POST", body: { scope, confirm: typed.trim() } });
                setBusy(false);
                setOpen(false);
                setTyped("");
                const d = r.data;
                if (!r.ok || !d) {
                  toast(r.error ?? "صار خطأ", "error");
                  return;
                }
                // one of the four sentences, from what the server counted (src/core/stop-result.ts)
                const sentence = d.sentence ?? stopSentence(d);
                if (d.state === "stopped") mission({ title: sentence, detail: "بترجعها من «بانتظارك ← قررتها»" });
                else toast(sentence, d.state === "partial" ? "error" : "info");

              }}
            >
              اوقف الكل
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
