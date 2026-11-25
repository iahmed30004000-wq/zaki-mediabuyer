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
 * Whether a video can be used by a launch on this account. Meta's documentation says a video is uploaded INTO one ad account's library and says nothing about
 * using it from another, so none is assumed: a launch takes the videos of its own account. A video nobody recorded an account for is taken only when there is
 * a single account it could be in.
 */
export function videoProblem(videoAccount: string | null, accountMetaId: string, accounts: number): string | null {
  if (videoAccount) return videoAccount === accountMetaId ? null : "مرفوع على حساب إعلاني تاني";
  return accounts === 1 ? null : "ما منعرف على أي حساب انرفع، وعندك أكتر من حساب";
}

/**
 * The accounts offered for a product's market (and, when they are given, for the accounts the chosen videos were uploaded to). Never «the first one»: one is
 * preselected only when it is the single account of that market, or — when no account carries the market — the single account that could take it at all.
 * Two accounts of one market, or none, and the owner picks.
 */
export function accountChoices(accounts: readonly LaunchAccount[], market: string, videos?: readonly (string | null)[]): AccountChoice {
  const fits = accounts.filter((a) => !accountProblem(a, market));
  const holding = videos ? fits.filter((a) => videos.every((v) => !videoProblem(v, a.metaId, accounts.length))) : fits;
  const own = holding.filter((a) => a.market === market);
  const options = [...own, ...holding.filter((a) => a.market !== market)];
  const preselected = own.length === 1 ? own[0]!.metaId : own.length === 0 && options.length === 1 ? options[0]!.metaId : null;
  const none = options.length
    ? null
    : !accounts.length
      ? "ما في حساب إعلاني مربوط"
      : !fits.length
        ? `ما في حساب إعلاني بالدولار لسوق ${marketLabel(market)} — حدّد سوق الحساب بالإعدادات ← القواعد`
        : "الفيديوهات المختارة مش كلها مرفوعة على حساب واحد بينفع لهالإطلاق — اختار فيديوهات من نفس الحساب";
  return { options, preselected, none };
}

/**
 * The account a ready video is uploaded to: the one the owner chose for the product's market, else the single one there is to choose (a dollar account first —
 * only it can launch). More than one and no choice of his: the video waits, with the sentence. Never «the first one».
 */
export function uploadAccount(accounts: readonly LaunchAccount[], market: string | null, chosen: Readonly<Record<string, string>>): { metaId: string } | { why: string } {
  if (!accounts.length) return { why: "ما في حساب إعلاني مربوط — الفيديوهات الجاهزة مستنية" };
  const allowed = market ? accounts.filter((a) => !a.market || a.market === market) : [...accounts];
  const picked = market ? allowed.find((a) => a.metaId === chosen[market]) : undefined;
  if (picked) return { metaId: picked.metaId };
  const own = market ? allowed.filter((a) => a.market === market) : [];
  const pool = own.length ? own : allowed;
  const dollars = pool.filter((a) => currencyGate(a.currency).ok);
  const last = dollars.length ? dollars : pool;
  if (last.length === 1) return { metaId: last[0]!.metaId };
  if (!market) return { why: "في فيديوهات جاهزة بلا منتج معروف، وعندك أكتر من حساب إعلاني — حدّد منتجها لتنرفع" };
  if (!last.length) return { why: `ما في حساب إعلاني لسوق ${marketLabel(market)} — حدّد سوق الحساب بالإعدادات ← القواعد ← السقوف، لترتفع فيديوهاته` };
  return { why: `في أكتر من حساب إعلاني لسوق ${marketLabel(market)} — اختار حساب رفع الفيديوهات بالإعدادات ← القواعد ← السقوف` };
}

export function datasetProblem(datasetId: string, known: string[]): string | null {
  if (!known.length) return "ما في Dataset مسجّل بالموقع — سجّله أول (ما بنقبل رقم بيتكتب باليد)";
  return known.includes(datasetId) ? null : "الـ Dataset مش من اللي بيعرفهم الموقع";
}
