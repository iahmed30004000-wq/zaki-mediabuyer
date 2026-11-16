"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CircleHelp, MessageCircleQuestion, Play, RotateCcw, Send, TriangleAlert } from "lucide-react";
import { Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Artifact, Fact, SourceRef } from "@/core/assistant";
import { guideOf } from "@/lib/guide";
import { ArtifactCard, FactsList } from "./assistant-cards";
import { runTour } from "./page-help";
import { useCurrentPlace } from "./shell-context";

/** Fired by the header button on phones. */
export const CONSULTANT_EVENT = "mb:consultant";

const STARTERS: Record<string, string[]> = {
  today: ["كم كلفة الطلب الحقيقي امبارح؟", "شو بانتظار موافقتي؟", "لخّصلي اليوم"],
  ads: ["أي إعلان أغلى طلب حقيقي هالأسبوع؟", "شو الإعلانات اللي لازم تتوقف؟"],
  videos: ["كم فيديو ناقص بالبنك لكل منتج؟", "مين الفيديوهات الرابحة؟"],
  tasks: ["شو المهام المفتوحة؟", "اعملي مهمة: متابعة الكرتون بكرا"],
  workflow: ["شو آخر تشغيل خلص؟", "ارسملي ورك فلو لمتابعة الشحنات العالقة"],
  done: ["لخّصلي امبارح بتلات أسطر"],
  settings: ["شو الفرق بين المستوى 1 و 2؟"],
};

interface Msg {
  me: boolean;
  text: string;
  facts?: Fact[];
  sources?: SourceRef[];
  artifacts?: Artifact[];
  unsupported?: string[];
  by?: string;
  notice?: string | null;
  tour?: boolean;
  drafted?: string;
  error?: boolean;
}

interface Info {
  mode: "assistant" | "consultant" | "demo";
  model: string | null;
  notice: string | null;
  canDraft: boolean;
}

interface Reply {
  mode?: string;
  answer?: string;
  facts?: Fact[];
  sources?: SourceRef[];
  artifacts?: Artifact[];
  unsupported?: string[];
  by?: string;
  notice?: string | null;
}

type StreamEvent = { type: "status"; text: string } | { type: "final"; reply: Reply } | { type: "error"; message: string };

/** The answer comes as lines of JSON: what it is doing (`status`), then one `final` or `error`. */
async function readStream(res: Response, onEvent: (e: StreamEvent) => void) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const flush = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as StreamEvent);
    } catch {
      // a half line: the next chunk completes it
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i = buf.indexOf("\n");
    while (i >= 0) {
      flush(buf.slice(0, i));
      buf = buf.slice(i + 1);
      i = buf.indexOf("\n");
    }
  }
  flush(buf);
}

const MODE_CHIP: Record<Info["mode"], string> = { assistant: "Claude", consultant: "من أرقام الكود", demo: "تجريبي" };

/**
 * The assistant (v3 · H) is not a place: a button on every page that knows where you are. It answers from the screens' own
 * numbers through tools (every answer says where its numbers come from, and a number no tool returned is flagged), makes tasks,
 * and drafts — a workflow, a step, a prompt — and PROPOSES changes. It never spends and never touches Meta: a proposal waits for
 * your yes on the site. Without a Claude key it falls back to the consultant's facts.
 */
export function Consultant() {
  const place = useCurrentPlace();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [log, setLog] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement | null>(null);

  /** «اشرح لي هالشاشة» (it replaced the guide page): this place's own explanation, from the guide — no model, no numbers. */
  const explain = () => {
    const g = guideOf(place.key);
    setLog((l) => [...l, { me: true, text: "اشرح لي هالشاشة" }, { me: false, text: `${g.what}\n\nالخطوة الجاية: ${g.next}`, by: "guide", tour: true }]);
  };

  // The button lives in the page header (no floating button over the content): it sends this event.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(CONSULTANT_EVENT, show);
    return () => window.removeEventListener(CONSULTANT_EVENT, show);
  }, []);

  // is it connected, and may this person save its drafts — asked once, the first time the panel opens
  useEffect(() => {
    if (!open || info) return;
    fetch("/api/assistant", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Info>) : null))
      .then((d) => d && setInfo(d))
      .catch(() => undefined);
  }, [open, info]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [log, status]);

  // the conversation is kept for this person: it comes back when the panel opens (only if nothing was said yet), and is saved after each answer
  const restored = useRef(false);
  useEffect(() => {
    if (!open || restored.current) return;
    restored.current = true;
    fetch("/api/assistant/chat", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<{ messages?: Msg[] }>) : null))
      .then((d) => d?.messages?.length && setLog((l) => (l.length ? l : d.messages!)))
      .catch(() => undefined);
  }, [open]);
  useEffect(() => {
    if (busy || !restored.current || !log.length) return;
    const t = setTimeout(() => {
      // the walk-through of the screen is not a conversation; an error line is not worth keeping
      const keep = log.filter((m) => !m.tour && !m.error);
      if (keep.length) void fetch("/api/assistant/chat", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: keep }) }).catch(() => undefined);
    }, 700);
    return () => clearTimeout(t);
  }, [log, busy]);

  const push = (m: Msg) => setLog((l) => [...l, m]);
  const fromReply = (r: Reply): Msg => ({ me: false, text: r.answer ?? "ما طلع جواب — جرّب كمان مرة", facts: r.facts, sources: r.sources, artifacts: r.artifacts, unsupported: r.unsupported, by: r.by, notice: r.notice });

  const reset = () => {
    abort.current?.abort();
    void fetch("/api/assistant/chat", { method: "DELETE" }).catch(() => undefined);
    setLog([]);
    setBusy(false);
    setStatus(null);
  };

  const ask = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history = log.filter((m) => !m.error && !m.tour && m.text).slice(-8).map((m) => ({ role: m.me ? "user" : "assistant", text: m.text }));
    push({ me: true, text: question });
    setQ("");
    setBusy(true);
    setStatus("عم بفكّر…");
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const r = await fetch("/api/assistant", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal, body: JSON.stringify({ question, history, place: { key: place.key, label: place.label } }) });
      if ((r.headers.get("content-type") ?? "").includes("ndjson") && r.body) {
        let finished = false;
        await readStream(r, (e) => {
          if (e.type === "status") setStatus(e.text);
          else if (e.type === "final") {
            finished = true;
            push(fromReply(e.reply));
          } else if (e.type === "error") {
            finished = true;
            push({ me: false, text: e.message, error: true });
          }
        });
        if (!finished) push({ me: false, text: "انقطع الاتصال قبل ما يكمّل الجواب — جرّب كمان مرة", error: true });
      } else {
        const j = (await r.json().catch(() => ({}))) as Reply & { error?: string };
        push(r.ok ? fromReply(j) : { me: false, text: j.error ?? "ما زبط — جرّب كمان مرة", error: true });
      }
    } catch (e) {
      if (!ctl.signal.aborted) push({ me: false, text: "ما قدرت أوصل للموقع — جرّب كمان مرة", error: true });
      void e;
    } finally {
      if (abort.current === ctl) {
        setBusy(false);
        setStatus(null);
      }
    }
  };

  const close = () => setOpen(false);

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              المساعد
              {info ? <span className="rounded-md bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent">{MODE_CHIP[info.mode]}</span> : null}
            </SheetTitle>
            <SheetDescription>بيفهم إنك هلأ بـ «{place.label}». بيجاوب من أرقام الشاشات وبيعمل مهام ومسودات، وما بينفّذ صرف — أي تغيير بيستنى موافقتك.</SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={explain} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 text-sm font-medium text-accent hover:bg-accent/10">
                <CircleHelp className="size-4" />
                اشرح لي هالشاشة
              </button>
              {log.length ? (
                <button type="button" onClick={reset} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-xs text-fg-muted hover:bg-surface-2 hover:text-fg">
                  <RotateCcw className="size-3.5" />
                  محادثة جديدة
                </button>
              ) : null}
            </div>
            {info?.notice ? <p className="rounded-lg border border-dashed border-border p-2.5 text-xs leading-5 text-fg-muted">{info.notice}</p> : null}
            {log.length === 0 ? (
              <div className="flex flex-wrap gap-2">
                {(STARTERS[place.key] ?? []).map((s) => (
                  <button key={s} type="button" onClick={() => ask(s)} className="rounded-full border border-border px-3 py-1.5 text-xs text-fg hover:border-accent/60 hover:bg-accent/5">
                    {s}
                  </button>
                ))}
              </div>
            ) : (
              log.map((m, i) => (
                <div key={i} className={m.me ? "ms-8 rounded-xl bg-accent px-3 py-2 text-sm text-accent-fg" : m.error ? "me-8 rounded-xl border border-dashed border-border px-3 py-2 text-sm text-fg-muted" : "me-8 space-y-2 rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg"}>
                  <p className="whitespace-pre-wrap leading-6">{m.text}</p>
                  {m.tour ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-accent">
                      <button
                        type="button"
                        onClick={() => {
                          close();
                          setTimeout(() => void runTour(place.key), 250);
                        }}
                        className="inline-flex items-center gap-1 hover:underline"
                      >
                        <Play className="size-3.5" />
                        فرجيني
                      </button>
                      <Link href="/settings#guide" onClick={close} className="hover:underline">
                        الدليل والمصطلحات
                      </Link>
                    </div>
                  ) : null}
                  {!m.me && m.unsupported?.length ? (
                    <p className="flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-2 py-1.5 text-xs leading-5 text-fg">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-warn" />
                      <span>
                        ما قدرت أتحقق من: <span dir="ltr">{m.unsupported.join(" · ")}</span> — مش من أرقام الأدوات، فلا تعتمد عليها قبل ما تشوفها بالشاشة.
                      </span>
                    </p>
                  ) : null}
                  {m.artifacts?.map((a, n) => (
                    <ArtifactCard key={n} a={a} canDraft={!!info?.canDraft} onNavigate={close} />
                  ))}
                  {!m.me && m.by === "agent" && /بقترح|اقتراح|وقّف|وقف|خفّض|كبّر/.test(m.text) ? (
                    m.drafted ? (
                      <a href="/work/tasks" className="block text-xs font-medium text-accent">{m.drafted}</a>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          const r = await fetch("/api/agents/prepare", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: m.text }) });
                          const j = (await r.json()) as { ok?: boolean; error?: string; items?: number; refused?: string[] };
                          setLog((l) => l.map((x, n) => (n === i ? { ...x, drafted: r.ok ? `انعملت مسودة (${j.items ?? 0} تغيير) — بانتظارك بـ «المهام»${j.refused?.length ? ` · انشال: ${j.refused.join("، ")}` : ""}` : j.error ?? "ما زبط" } : x)));
                        }}
                        className="text-xs font-medium text-accent hover:underline"
                      >
                        حوّلها لمسودة تغيير (بتستنى موافقتك)
                      </button>
                    )
                  ) : null}
                  {!m.me && (m.facts?.length || m.sources?.length) ? <FactsList facts={m.facts ?? []} sources={m.sources ?? []} onNavigate={close} /> : null}
                  {!m.me && m.notice ? <p className="text-[11px] leading-5 text-fg-muted">{m.notice}</p> : null}
                </div>
              ))
            )}
            {busy ? (
              <p role="status" className="me-8 animate-pulse rounded-xl bg-surface-2 px-3 py-2 text-sm text-fg-muted">
                {status ?? "عم بفكّر…"}
              </p>
            ) : null}
            <div ref={end} />
          </SheetBody>
          <SheetFooter className="flex-nowrap">
            <form
              className="flex w-full gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(q);
              }}
            >
              <input value={q} onChange={(e) => setQ(e.target.value)} maxLength={1000} placeholder="اكتب سؤالك…" dir="auto" className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 text-sm text-fg" />
              <button type="submit" disabled={busy} aria-label="ابعت" className="inline-flex size-11 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-50">
                <Send className="size-4 rtl:-scale-x-100" />
              </button>
            </form>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
