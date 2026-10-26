/**
 * THE POLICY GUARD, CODE FIRST (spec 8.5 step 1) — a dictionary over every text of an ad: the ad copy, the transcript
 * of the voice, the text on screen and the landing page. The golden rule (8.1): talk about the PRODUCT, never about
 * the viewer and their condition.
 *
 *   red    (8.2) forbidden — not uploaded; with a safe alternative when one exists (8.4) → verdict «edit», else «block»
 *   yellow (8.3) allowed with the owner's approval
 *   green  nothing found
 * The contextual judge (agent M05) comes after this and can only make a verdict stricter, never looser.
 */
export type PolicyLevel = "red" | "yellow";

export interface PolicyRule {
  id: string;
  level: PolicyLevel;
  /** the Meta policy section, for the reason line */
  rule: string;
  /** matched on normalised text */
  patterns: RegExp[];
  /** the safe wording to use instead (8.4) */
  alternative?: string;
}

/** Diacritics, tatweel and letter variants out; the words of all the dialects in. */
export function normalize(text: string): string {
  return text
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[ؤ]/g, "و")
    .replace(/[ئ]/g, "ي")
    .replace(/[…]/g, "...")
    .toLowerCase();
}

const w = (s: string) => new RegExp(s, "u");

export const RULES: PolicyRule[] = [
  // a religious text as a cure claim for the product
  { id: "religious_claim", level: "red", rule: "Health and Wellness — ادعاء فعالية بنص ديني", patterns: [w("(ماوها شفاء|وماوها شفاء|شفاء للعين|طب نبوي|الطب النبوي|علاج من الطب النبوي)")], alternative: "الكمأة، مكوّن تراثي معروف من زمان" },
  // 8.2 — cure words and absolute promises
  { id: "cure", level: "red", rule: "Health and Wellness — ادعاء علاجي", patterns: [w("(يشفي|شفاء|بيشفي|تشفي|علاج نهائي|يعالج|بيعالج|يقضي على|بيقضي على|يزيل نهائيا|بيشيل نهائيا)")], alternative: "تُستعمل ضمن روتين العناية اليومي" },
  { id: "guarantee", level: "red", rule: "Unrealistic Outcomes — وعد بنتيجة", patterns: [w("(مضمون ?100|مضمونه ?100|نتيجه (خلال|ب) ?\\d+ ?(يوم|ايام|اسبوع))"), w("خلال (اسبوع|يومين|\\d+ ايام) (بيروح|بتختفي|بيختفي)")], alternative: "مع الاستعمال المنتظم" },
  // a named disease
  { id: "disease", level: "red", rule: "Health and Wellness — ربط بمرض", patterns: [w("(الماء الابيض|الماء الازرق|ضعف النظر|السكري|السكر بالدم|الضغط|التهاب|المياه البيضاء|الزرقاء)")], alternative: "قطرة ماء الكمأة، من وصفات التراث للعناية بالعين" },
  // addressing the viewer's condition, age or faith
  { id: "personal", level: "red", rule: "Personal Attributes — مخاطبة حالة المشاهد", patterns: [w("(هل تعاني|بتعاني|عندك (طنين|ضعف|حساسيه|ندب|فطريات|مشكله)|تعبت من|زهقت من)")], alternative: "الطنين بيزعج كتير ناس، خصوصاً بالليل" },
  { id: "personal_identity", level: "red", rule: "Personal Attributes — مخاطبة دين أو عمر", patterns: [w("(يا مسلم|يا مؤمن|اذا عمرك (فوق|اكتر من)|فوق ال ?\\d+ سنه)")] },
  // attacking competitors / unproven origin
  { id: "competitors", level: "red", rule: "Unacceptable Business Practices — اتهام المنافسين", patterns: [w("(كل الموجود مغشوش|كله مغشوش|احذر المقلد|احذروا التقليد|الوحيد الاصلي|ليس كل ما يباع.{0,30}(هو )?الاصلي)")], alternative: "عبوة مختومة ومعبأة بعناية · اطلب واستلم وادفع عند الباب" },
  { id: "origin", level: "red", rule: "Deceptive Practices — أصل بلا وثيقه", patterns: [w("(ماء زمزم 100|100 ?% طبيعي مضمون)")] },
  { id: "before_after", level: "red", rule: "Unrealistic Outcomes — قبل/بعد", patterns: [w("(قبل و ?بعد|قبل/بعد|before ?/ ?after)")], alternative: "لقطة للعبوة وطريقة الاستعمال" },
  // 8.3 — yellow: heritage and care wording, allowed with approval
  { id: "heritage", level: "yellow", rule: "تراث بلا وعد علاجي — بموافقة المالك", patterns: [w("(وصفات التراث|من التراث|وصفه قديمه|عنايه|روتين يومي|مع الاستعمال المنتظم)")] },
];

export interface PolicyHit {
  rule: string;
  ruleId: string;
  level: PolicyLevel;
  text: string;
  source: string;
  alternative: string | null;
}

export interface PolicyResult {
  flag: "green" | "yellow" | "red";
  verdict: "pass" | "edit" | "block";
  hits: PolicyHit[];
}

/** Check every text of an ad. `sources` is {adText, transcript, ocrText, lpText}; missing ones are skipped. */
export function checkPolicy(sources: Record<string, string | null | undefined>): PolicyResult {
  const hits: PolicyHit[] = [];
  for (const [source, raw] of Object.entries(sources)) {
    if (!raw) continue;
    const text = normalize(raw);
    for (const r of RULES) {
      for (const re of r.patterns) {
        const m = re.exec(text);
        // the most specific rule comes first: a word already inside an earlier hit of this text is not counted twice
        if (m && hits.some((h) => h.source === source && h.text.includes(m[0]))) break;
        if (m) {
          hits.push({ rule: r.rule, ruleId: r.id, level: r.level, text: m[0], source, alternative: r.alternative ?? null });
          break;
        }
      }
    }
  }
  const red = hits.filter((h) => h.level === "red");
  if (red.length) return { flag: "red", verdict: red.every((h) => h.alternative) ? "edit" : "block", hits };
  if (hits.length) return { flag: "yellow", verdict: "pass", hits };
  return { flag: "green", verdict: "pass", hits };
}

/** The note the owner reads under a flagged video. */
export function policyNote(r: PolicyResult): string | null {
  if (!r.hits.length) return null;
  return r.hits
    .map((h) => `«${h.text}» ${h.level === "red" ? "ممنوع" : "بدو موافقتك"} (${h.rule})${h.alternative ? ` — البديل: «${h.alternative}»` : ""}`)
    .join("\n");
}
