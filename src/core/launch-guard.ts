/**
 * WHAT A LAUNCH MAY POINT AT (v6 · P10) — pure.
 *
 * A launch writes a landing link and a conversion dataset into Meta. Both come from the person's request, so both are checked against what the
 * owner registered: the product's landing pages in the settings (`landing.pages`), and the datasets the site knows. An https link of any
 * site, or a dataset id typed by hand, is refused — an ad must never send people (or the conversions) somewhere the owner did not choose.
 */
import { marketLabel } from "./markets";
import { currencyGate } from "./rulebook";

export interface LandingPage {
  productCode: string;
  lpCode: string;
  url: string;
}

/** A link compared without its trailing slash, its fragment or the case of the host. Null when it is not a link. */
export function normalizeUrl(u: string): string | null {
  try {
    const x = new URL(u.trim());
    if (x.protocol !== "https:") return null;
    x.hash = "";
    const path = x.pathname.replace(/\/+$/, "");
    return `${x.protocol}//${x.host.toLowerCase()}${path}${x.search}`;
  } catch {
    return null;
  }
}

export function landingProblem(input: { productCode: string; lpCode: string; landingUrl: string }, pages: LandingPage[]): string | null {
  const url = normalizeUrl(input.landingUrl);
  if (!url) return "رابط صفحة الهبوط لازم يبلّش بـ https وما يكون مكسور";
  const mine = pages.filter((p) => p.productCode === input.productCode && p.lpCode === input.lpCode);
  if (!mine.length) return `صفحة الهبوط ${input.lpCode} لـ ${input.productCode} مش مسجّلة بالإعدادات — سجّلها أول`;
  return mine.some((p) => normalizeUrl(p.url) === url) ? null : `الرابط مش هو المسجّل لـ ${input.lpCode} بالإعدادات — الإعلان ما بيروح لرابط غير اللي سجّلته`;
}

// ───────────────────────────── the ad account of a launch (v6 · P11) ─────────────────────────────

export interface LaunchAccount {
  metaId: string;
  name: string;
  /** the market the owner set on the account; null: not set */
  market: string | null;
  currency: string;
}

export interface AccountChoice {
  /** the accounts the owner may pick for a product of this market: the market's own first, then the ones with no market */
  options: LaunchAccount[];
  /** chosen for him only when there is nothing to choose between; null: he picks */
  preselected: string | null;
  /** why there is nothing to pick */
  none: string | null;
}

/** Whether an account can take a launch for a market, or the sentence why not. The site writes budgets in dollars (D80). */
export function accountProblem(account: Pick<LaunchAccount, "market" | "currency">, market: string): string | null {
  if (!currencyGate(account.currency).ok) return `الحساب الإعلاني بعملة ${account.currency || "مش معروفة"} — الإطلاق بيكتب الميزانية بالدولار بس`;
  if (account.market && account.market !== market) return `الحساب الإعلاني مسجّل لسوق ${marketLabel(account.market)}، والمنتج لسوق ${marketLabel(market)}`;
  return null;
}

/**
 * The accounts offered for a product's market. Never «the first one»: one is preselected only when it is the single account of that market, or — when no
 * account carries the market — the single account that could take it at all. Two accounts of one market, or none, and the owner picks.
 */
export function accountChoices(accounts: readonly LaunchAccount[], market: string): AccountChoice {
  const fits = accounts.filter((a) => !accountProblem(a, market));
  const own = fits.filter((a) => a.market === market);
  const options = [...own, ...fits.filter((a) => a.market !== market)];
  const preselected = own.length === 1 ? own[0]!.metaId : own.length === 0 && options.length === 1 ? options[0]!.metaId : null;
  const none = options.length ? null : accounts.length ? `ما في حساب إعلاني بالدولار لسوق ${marketLabel(market)} — حدّد سوق الحساب بالإعدادات ← القواعد` : "ما في حساب إعلاني مربوط";
  return { options, preselected, none };
}

export function datasetProblem(datasetId: string, known: string[]): string | null {
  if (!known.length) return "ما في Dataset مسجّل بالموقع — سجّله أول (ما بنقبل رقم بيتكتب باليد)";
  return known.includes(datasetId) ? null : "الـ Dataset مش من اللي بيعرفهم الموقع";
}
