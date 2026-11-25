"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/input";
import { withMarket } from "@/core/markets";
import { MARKETS, MARKET_AR } from "@/core/naming";

/**
 * The one market filter of the numbers and the ads (v6 · P11): «كل الأسواق» or one of the markets the site knows. The choice lives in the address
 * (`?market=JO`), beside whatever else is there, so Back, a refresh and a shared link keep it.
 */
export function MarketSwitcher({ market }: { market: string | null }) {
  const router = useRouter();
  const path = usePathname() ?? "/numbers";
  const params = useSearchParams();
  const go = (next: string) => {
    const query = withMarket(params?.toString() ?? "", next || null);
    router.replace(query ? `${path}?${query}` : path, { scroll: false });
  };
  return (
    <Select aria-label="السوق" value={market ?? ""} onChange={(e) => go(e.target.value)} className="w-auto min-w-[11rem]" data-tour="market">
      <option value="">كل الأسواق</option>
      {MARKETS.map((m) => (
        <option key={m} value={m}>
          {MARKET_AR[m]}
        </option>
      ))}
    </Select>
  );
}
