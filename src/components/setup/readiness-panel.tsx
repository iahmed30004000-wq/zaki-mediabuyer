import { CircleDot } from "lucide-react";
import { Panel } from "@/components/mb/section";
import { TelegramHook } from "./telegram-hook";
import type { Readiness, ReadinessRow } from "@/lib/readiness-view";
import { cn } from "@/lib/utils";

const when = (iso: string) => new Intl.DateTimeFormat("ar-SY-u-nu-latn", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));

type Tone = "ok" | "warn" | "danger" | "muted";

/** One link: the verdict in one word, and the line under it that says why. */
function verdict(r: ReadinessRow): { tone: Tone; word: string } {
  if (r.later && !r.linked) return { tone: "muted", word: "بعدين" };
  if (!r.linked) return { tone: "warn", word: "ناقص" };
  if (r.last.at && r.last.ok === false) return { tone: "danger", word: "آخر نداء فشل" };
  if (r.last.at) return { tone: "ok", word: "اشتغل" };
  return { tone: "warn", word: "مربوط — لسا ما صار نداء حقيقي" };
}

const TONE: Record<Tone, string> = { ok: "text-ok", warn: "text-warn", danger: "text-danger", muted: "text-fg-muted" };

/**
 * «جاهزية الربط»: every link in one list — is its key there (the NAMES of what is missing, never a value), and when did a real
 * call last happen and how did it end. Under the demo nothing here is a real call; the banner says so.
 */
export function ReadinessPanel({ data }: { data: Readiness }) {
  const linked = data.rows.filter((r) => r.linked).length;
  return (
    <section aria-labelledby="readiness-title" className="space-y-3 rounded-card border border-border bg-surface-1 p-4 shadow-card sm:p-5" data-tour="readiness">
      <div>
        <h2 id="readiness-title" className="text-xl font-bold text-fg">جاهزية الربط</h2>
        <p className="text-sm text-fg-muted">
          {linked} من {data.rows.length} مربوطين. كل سطر بيقول إذا المفتاح موجود (بأسماء الناقص بس، ولا قيمة) ومتى صار آخر نداء حقيقي وكيف خلص. الفحص الحي: <code dir="ltr">docs/LIVE_CHECKS.md</code>
        </p>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {data.rows.map((r) => {
          const v = verdict(r);
          return (
            <Panel key={r.key} className="space-y-1.5">
              <div className="flex items-center gap-2">
                <CircleDot className={cn("size-4 shrink-0", TONE[v.tone])} aria-hidden />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-fg">{r.label}</p>
                <span className={cn("shrink-0 text-xs font-medium", TONE[v.tone])}>{v.word}</span>
              </div>
              <p className="text-xs text-fg-muted">{r.why}{r.writes ? " · بيكتب برّا" : ""}</p>
              {r.missing.length ? (
                <p className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
                  ناقص:
                  {r.missing.map((m) => (
                    <code key={m} dir="ltr" className="rounded bg-surface-2 px-1.5 py-0.5 text-xs text-fg">{m}</code>
                  ))}
                </p>
              ) : null}
              {r.key === "telegramIn" && r.linked ? <TelegramHook /> : null}
              <p className="text-xs text-fg-muted">
                {r.last.at ? (
                  <>
                    آخر نداء حقيقي: <time dateTime={r.last.at} className="text-fg">{when(r.last.at)}</time> — {r.last.ok ? "نجح" : "فشل"}
                    {r.last.what ? ` (${r.last.what})` : ""}
                  </>
                ) : (
                  "ما صار ولا نداء حقيقي"
                )}
              </p>
            </Panel>
          );
        })}
      </div>
      <p className={cn("text-xs leading-5", data.metaWrite.mode === "live" ? "text-warn" : "text-fg-muted")}>
        <span className="font-semibold text-fg">الكتابة على ميتا: </span>
        {data.metaWrite.line}
      </p>
    </section>
  );
}
