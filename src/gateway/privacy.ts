/**
 * THE PRIVACY FILTER (spec 11.1): before ANY text goes to ANY model, it is checked here. A text that looks like a
 * key/token or carries a phone number or an e-mail is refused — not cleaned and sent, refused — and the refusal is
 * logged. Customer data must never be put in a prompt in the first place; this is the net under that rule.
 */
export type PrivacyHit = "token" | "phone" | "email";

const PATTERNS: [PrivacyHit, RegExp][] = [
  // Meta access tokens, API keys, bearer strings, JWTs
  ["token", /\bEAA[A-Za-z0-9]{20,}/],
  ["token", /\b(sk|pk|rk)[-_](live|test|proj|ant)?[-_]?[A-Za-z0-9_-]{16,}/i],
  ["token", /\bBearer\s+[A-Za-z0-9._-]{16,}/i],
  ["token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ["token", /\b(gh[pousr]|xox[abp])_[A-Za-z0-9]{20,}/],
  ["token", /\b[A-Fa-f0-9]{40,}\b/],
  // phones: international (+963 / +962 / 00…) and the local Syrian / Jordanian mobile shapes
  ["phone", /(?:\+|00)\s?\d{3}[\s-]?\d{2,3}[\s-]?\d{3}[\s-]?\d{3,4}/],
  ["phone", /\b0?9\d{8}\b/],
  ["phone", /\b0?7[789]\d{7}\b/],
  ["email", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
];

/** Arabic-Indic digits count as digits: a phone written ٠٩٤٤… is still a phone. */
function westernDigits(s: string): string {
  return s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function privacyHits(text: string): PrivacyHit[] {
  const t = westernDigits(text);
  return [...new Set(PATTERNS.filter(([, re]) => re.test(t)).map(([hit]) => hit))];
}

export class PrivacyRefusal extends Error {
  constructor(public hits: PrivacyHit[]) {
    super(`refused: the text contains ${hits.join(", ")}`);
  }
}

export function assertClean(texts: string[]): void {
  const hits = [...new Set(texts.flatMap(privacyHits))];
  if (hits.length) throw new PrivacyRefusal(hits);
}
