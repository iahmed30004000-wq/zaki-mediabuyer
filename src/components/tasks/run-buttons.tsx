"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Select } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { waitingText } from "@/core/handoff";
import type { CardAction, CardActionKey } from "@/core/tasks-view";
import { runHref } from "@/core/tasks-view";
import { callJson } from "@/lib/call";

const DONE: Record<Exclude<CardActionKey, "open" | "run_now">, string> = {
  retry: "رجعت للدور — بتكمّل من الخطوة اللي وقفت",
  skip: "انتخطت الخطوة — بتكمّل من اللي بعدها",
  cancel: "ألغيت التشغيل",
  dismiss: "تجاهلتها",
};

interface Answer {
  ok?: boolean;
  demo?: boolean;
  created?: boolean;
  since?: string;
  /** a recipe: the site carried it out right now, and this is how it ended */
  site?: boolean;
  status?: "ok" | "failed";
  summary?: string;
}

/**
 * The buttons of a run (docs/rebuild-v6/01-model.md §8) — each does one real thing through the site's own routes and says what happened: a request for the job's agent, a step set
 * aside, a run ended. `open` is a link. The site never runs the steps: it asks the agent, so the sentence says «انطلبت». A person without the right to control sees only the link.
 */
export function RunButtons({ jobKey, runId, actions, canControl, className }: { jobKey: string; runId: string | null; actions: readonly CardAction[]; canControl: boolean; className?: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<CardActionKey | null>(null);

  async function press(key: Exclude<CardActionKey, "open">) {
    if (busy) return;
    setBusy(key);
    try {
      const r = key === "run_now" ? await callJson<Answer>(`/api/workflow/${encodeURIComponent(jobKey)}/run`, { method: "POST" }) : await callJson<Answer>(`/api/jobs/${encodeURIComponent(jobKey)}/runs/${encodeURIComponent(runId ?? "")}/${key}`, { method: "POST", body: {} });
      if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
      if (r.data?.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
      if (key === "run_now" && r.data?.site) {
        toast(r.data.status === "failed" ? `اشتغلت من الموقع ووقفت: ${r.data.summary ?? ""}`.trim() : `اشتغلت من الموقع ✓ ${r.data.summary ?? ""}`.trim(), r.data.status === "failed" ? "error" : "success");
      } else if (key === "run_now") {
        const since = r.data?.created === false && r.data.since ? Math.max(0, Math.round((Date.now() - Date.parse(r.data.since)) / 60_000)) : null;
        toast(since !== null ? `مطلوبة ${waitingText(since)} — لسا ما حدا استلمها` : "انطلبت — بتشتغل بأقرب فرصة", since !== null ? "info" : "success");
      } else toast(DONE[key], "success");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const visible = actions.filter((a) => a.key === "open" || canControl);
  if (!visible.length) return null;
  return (
    <div className={className ?? "flex flex-wrap items-center gap-2"}>
      {visible.map((a) =>
        a.key === "open" ? (
          <ButtonLink key={a.key} href={runHref(jobKey, runId)} variant={a.variant} size="sm">
            {a.label}
          </ButtonLink>
        ) : (
          <Button key={a.key} variant={a.variant} size="sm" loading={busy === a.key} disabled={!!busy && busy !== a.key} {...(a.key === "cancel" ? { confirm: "متأكد؟" } : {})} onClick={() => void press(a.key as Exclude<CardActionKey, "open">)}>
            {a.label}
          </Button>
        ),
      )}
    </div>
  );
}

/** «سلّمها لغيره»: the request this run waits on goes to somebody else — the choices are the agents and people of the team. */
export function ReassignControl({ jobKey, runId, options }: { jobKey: string; runId: string; options: readonly { key: string; label: string }[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [to, setTo] = useState(options[0]?.key ?? "");
  const [busy, setBusy] = useState(false);
  if (!options.length) return null;
  async function send() {
    setBusy(true);
    try {
      const r = await callJson<Answer>(`/api/jobs/${encodeURIComponent(jobKey)}/runs/${encodeURIComponent(runId)}/reassign`, { method: "POST", body: { assignee: to } });
      if (!r.ok) return toast(r.error ?? "صار خطأ", "error");
      if (r.data?.demo) return toast("بالوضع التجريبي ما تغيّر شي", "info");
      toast("انسلّمت لغيره ✓", "success");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="مين ياخدها" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto min-w-40">
        {options.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </Select>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void send()}>
        سلّمها لغيره
      </Button>
    </div>
  );
}
