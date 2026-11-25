import Link from "next/link";
import { CURRENCY_AR, missingRateText } from "@/core/currency";

/**
 * Said above the numbers when something could not be added (v6 · P11): a currency with no exchange rate (its amounts are «—», never summed as dollars),
 * and a product in two markets whose pushed days carry no market. Draws nothing when there is nothing to say.
 */
export function FxNotice({ codes, unplaced = [] }: { codes: readonly string[]; unplaced?: readonly string[] }) {
  if (!codes.length && !unplaced.length) return null;
  return (
    <div className="space-y-1 rounded-card border border-warn/45 bg-warn/[0.06] p-3 text-base text-fg" role="status">
      {codes.length ? (
        <p>
          <b>{missingRateText(codes)}</b>
          {codes.some((c) => CURRENCY_AR[c]) ? ` (${codes.map((c) => CURRENCY_AR[c] ?? c).join("، ")})` : ""}. المبالغ بهالعملة ما انجمعت، وكل رقم بيعتمد عليها «—» وما بينحكم عليه.{" "}
          <Link href="/settings/rules#currency" className="inline-flex min-h-11 items-center font-semibold text-info hover:underline">
            اكتب السعر
          </Link>
        </p>
      ) : null}
      {unplaced.length ? <p>أرقام Claude المبعوتة ما إلها سوق، فما انحسبت لمنتج ظاهر بأكتر من سوق: {unplaced.join("، ")}.</p> : null}
    </div>
  );
}
