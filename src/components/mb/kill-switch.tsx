"use client";

import { useState } from "react";
import { OctagonX } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ACCOUNTS } from "@/lib/mock/data";
import { cn } from "@/lib/utils";

/**
 * The full stop (spec 10.3, 18.2): always visible at the top, in the risk frame. Two confirmations:
 * pick what to stop, then type «اوقف». Logged as a KillSwitchEvent once the backend lands.
 */
export function KillSwitch({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<string>("all");
  const [typed, setTyped] = useState("");
  const { toast } = useToast();
  const ready = typed.trim() === "اوقف";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tour="kill"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-danger/60 bg-danger/10 font-semibold text-danger transition-colors hover:bg-danger/15",
          compact ? "size-9 justify-center" : "h-9 px-3 text-sm",
        )}
        aria-label="الإيقاف الكامل"
      >
        <OctagonX className="size-4" />
        {compact ? null : <span>إيقاف كامل</span>}
      </button>
      <Modal
        open={open}
        title="إيقاف كامل"
        onClose={() => {
          setOpen(false);
          setTyped("");
        }}
      >
        <div className="space-y-4">
          <p className="text-sm text-fg">بيوقف كل الحملات فوراً بميتا. بترجعها من «القرارات» بزر رجوع، وكل شي بينسجّل.</p>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-medium text-fg-muted">شو بدك توقف؟</legend>
            {[{ id: "all", name: "كل الحسابات" }, ...ACCOUNTS.map((a) => ({ id: a.id, name: a.name }))].map((o) => (
              <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-border px-3 has-[:checked]:border-danger/60 has-[:checked]:bg-danger/5">
                <input type="radio" name="scope" value={o.id} checked={scope === o.id} onChange={() => setScope(o.id)} className="accent-[rgb(var(--danger))]" />
                <span className="text-sm text-fg">{o.name}</span>
              </label>
            ))}
          </fieldset>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-fg-muted">للتأكيد اكتب «اوقف»</span>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-fg" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              لا، رجوع
            </Button>
            <Button
              variant="danger"
              disabled={!ready}
              onClick={() => {
                setOpen(false);
                setTyped("");
                toast("بالوضع التجريبي ما وقف شي فعلاً. بعد الربط بيوقف كل الحملات خلال ثواني.", "info");
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
