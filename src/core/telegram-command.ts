/**
 * TELEGRAM COMMANDS (spec 9.6) — pure parsing. Allowed: «اوقف» on an ad / ad set / campaign (it only lowers spend).
 * Refused, always, with a pointer to the site: anything that raises spend, creates, resumes or approves
 * (spec 3.13 «ولا موافقة على صرف من تيليجرام»).
 */
export type TelegramCommand =
  | { kind: "pause"; query: string }
  | { kind: "site_only"; what: string }
  | { kind: "help" }
  | { kind: "unknown" };

const PAUSE = /^(?:\/)?(?:اوقف|أوقف|وقف|وقّف|stop|pause)\s+(.+)$/i;
const SITE_ONLY: [RegExp, string][] = [
  // (?=\s|$) and not \b: JavaScript's \b does not see Arabic letters as word characters
  [/^(?:\/)?(?:وافق|موافق|approve)(?=\s|$)/i, "الموافقة"],
  [/^(?:\/)?(?:زيد|زود|كبّر|كبر|ارفع|raise|scale)(?=\s|$)/i, "زيادة الصرف"],
  [/^(?:\/)?(?:شغّل|شغل|رجّع|رجع|resume)(?=\s|$)/i, "التشغيل"],
  [/^(?:\/)?(?:اطلق|أطلق|انشئ|أنشئ|create|launch)(?=\s|$)/i, "الإنشاء"],
];

/** Arabic-Indic digits → Latin, extra spaces collapsed. */
function clean(text: string): string {
  return text
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/\s+/g, " ")
    .trim();
}

export function parseTelegram(text: string): TelegramCommand {
  const t = clean(text);
  if (!t) return { kind: "unknown" };
  if (/^(?:\/)?(?:start|help|مساعدة|شو بتعمل)$/i.test(t)) return { kind: "help" };
  for (const [re, what] of SITE_ONLY) if (re.test(t)) return { kind: "site_only", what };
  const m = PAUSE.exec(t);
  if (m) return { kind: "pause", query: m[1]!.trim() };
  return { kind: "unknown" };
}

/** A query that names one creative: CR00147 / cr147 / 147 → CR00147. */
export function creativeCodeOf(query: string): string | null {
  const m = /^(?:cr)?\s*0*(\d{1,5})$/i.exec(query.trim());
  return m ? `CR${m[1]!.padStart(5, "0")}` : null;
}

export const HELP_AR = [
  "أنا بوت الميديا باير. بقدر:",
  "• اوقف CR00147 — بوقف الإعلان (أو اسم المجموعة أو الحملة)",
  "• بوصلك التقرير الصباحي الساعة 9 والتنبيهات",
  "أي زيادة صرف أو تشغيل أو موافقة: من الموقع بس.",
].join("\n");
