"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { safeFetch } from "@/lib/call";

interface Status {
  source: "env" | "site" | "none";
  hint: string | null;
  checkedAt: string | null;
  canStore: boolean;
  privacyOff: boolean;
  demo: boolean;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("ar", { dateStyle: "short", timeStyle: "short" }) : "ولا مرة");

/**
 * «ربط مفتاح Claude»: the owner pastes his Anthropic key once. The server tests it with Anthropic, keeps it encrypted, and shows
 * only its last four characters. A key in Coolify (ANTHROPIC_API_KEY) wins over this one.
 */
export function AnthropicLink() {
  const { toast } = useToast();
  const [st, setSt] = useState<Status | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await safeFetch("/api/assistant/connection");
    setSt(r.ok ? ((await r.json()) as Status) : null);
  }, []);
  useEffect(() => {
    load().catch(() => setSt(null));
  }, [load]);

  async function act(body: Record<string, string>, done: string) {
    setBusy(true);
    try {
      const r = await safeFetch("/api/assistant/connection", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json().catch(() => ({}))) as Partial<Status> & { error?: string };
      if (!r.ok) return toast(d.error ?? "صار خطأ", "error");
      setKey("");
      toast(done, "success");
      await load();
    } finally {
      setBusy(false);
    }
  }

  const linkedHere = st?.source === "site";
  const linkedEnv = st?.source === "env";
  const line = !st
    ? "…"
    : linkedEnv
      ? "موصول من Coolify (ANTHROPIC_API_KEY) — هو اللي بيشتغل."
      : linkedHere
        ? `موصول من الموقع — المفتاح ${st.hint} · آخر فحص ${when(st.checkedAt)}`
        : "مش موصول — الصق مفتاحك تحت.";

  return (
    <Panel className="space-y-3 md:col-span-2">
      <div className="flex items-start gap-3">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
          <KeyRound className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">ربط مفتاح Claude</p>
          <p className="text-xs leading-5 text-fg-muted">
            مفتاحك من console.anthropic.com. الموقع بيجرّبه مع Anthropic، وبيخزّنه مشفّر، وما بيرجّعه لأي شاشة (بيعرض آخر 4 حروف بس). المساعد بيجاوب منه، وكل رقم بيحسبه الكود مش الموديل. مفتاح Coolify لو موجود بيغلب هاد.
          </p>
          <p className="mt-1 text-xs text-fg">{line}</p>
        </div>
      </div>

      {st?.demo ? (
        <p className="text-xs text-fg-muted">الموقع على البيانات التجريبية — الربط بيشتغل لما الموقع يشتغل على أرقامك الحقيقية وتفتح كمالك مسجّل دخول.</p>
      ) : st?.privacyOff ? (
        <p className="text-xs text-fg-muted">PRIVACY_MODE=internal_only شغّال — أي موديل خارجي مقفول. غيّره لـ off بـ Coolify لو بدك تربط.</p>
      ) : !st ? null : linkedEnv ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => act({ action: "check" }, "المفتاح شغّال")}>
            افحص المفتاح
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {!st.canStore ? <p className="text-xs text-danger">ما في ENCRYPTION_KEY بـ Coolify — بدونه الموقع ما بيخزّن مفاتيح.</p> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              type="password"
              aria-label="مفتاح Claude"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              className="max-w-md flex-1"
              placeholder={linkedHere ? "مفتاح جديد (بيبدّل الحالي)" : "sk-ant-…"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              disabled={busy || !st.canStore}
            />
            <Button disabled={busy || !st.canStore || key.trim().length === 0} onClick={() => act({ action: "link", apiKey: key }, "انربط Claude")}>
              {linkedHere ? "بدّل المفتاح" : "اربط"}
            </Button>
            {linkedHere ? (
              <>
                <Button variant="secondary" disabled={busy} onClick={() => act({ action: "check" }, "المفتاح شغّال")}>
                  افحصه
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => act({ action: "unlink" }, "انفك الربط")}>
                  فك الربط
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </Panel>
  );
}
