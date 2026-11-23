/**
 * WHAT A LAUNCH MAY POINT AT (v6 · P10) — pure.
 *
 * A launch writes a landing link and a conversion dataset into Meta. Both come from the person's request, so both are checked against what the
 * owner registered: the product's landing pages in the settings (`landing.pages`), and the datasets the site knows. An https link of any
 * site, or a dataset id typed by hand, is refused — an ad must never send people (or the conversions) somewhere the owner did not choose.
 */
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

export function datasetProblem(datasetId: string, known: string[]): string | null {
  if (!known.length) return "ما في Dataset مسجّل بالموقع — سجّله أول (ما بنقبل رقم بيتكتب باليد)";
  return known.includes(datasetId) ? null : "الـ Dataset مش من اللي بيعرفهم الموقع";
}
